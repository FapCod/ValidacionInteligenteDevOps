// lib/gemini.ts
// Cliente híbrido de Inteligencia Artificial (OpenRouter + Gemini + Groq)
// Prioriza OpenRouter si está configurada la API Key (ideal para grandes volúmenes gratis).
// Si no, recurre a Groq o Google Gemini respectivamente.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ValidationResult } from "@/types";

const SYSTEM_PROMPT = `Eres un experto de nivel senior en revisión de código, archivos de configuración (XML, JSON, .env, .config, web.config, appsettings.json), Stored Procedures y scripts SQL.

Tu tarea es comparar la versión "antigua" (en producción) de un archivo con la versión "nueva" (a desplegar) y detectar:
1. Errores de sintaxis (tags XML sin cerrar, JSON mal formado, comas de más o faltantes, comillas no emparejadas, paréntesis sin cerrar en SQL, etc.)
2. Cambios estructurales sospechosos o de alto riesgo (claves eliminadas accidentalmente, claves duplicadas, indentación rota)
3. Omisiones o inconsistencias (variables de entorno referenciadas en el nuevo archivo que no están declaradas, o variables de producción eliminadas sin equivalentes)
4. Problemas en consultas SQL embebidas o Stored Procedures (validar sintaxis SQL básica, que las tablas/campos referenciados tengan coherencia lógica, cadenas de conexión mal formadas o parámetros de configuración faltantes)
5. Valores críticos sospechosos (parámetros vacíos, nulos o apuntando a entornos locales/desarrollo erróneos en el archivo de producción)

Responde ÚNICAMENTE en formato JSON plano con la siguiente estructura exacta. No agregues explicaciones adicionales fuera del JSON, no uses bloques de código con markdown ni backticks:
{
  "valido": true,
  "errores": ["Descripción detallada del error crítico 1", "Descripción detallada del error crítico 2"],
  "advertencias": ["Advertencia menor o sugerencia 1"],
  "resumen": "Resumen profesional de los cambios y hallazgos en 1 o 2 líneas"
}

Si encuentras algún error de sintaxis o inconsistencia crítica que pueda romper el despliegue o la base de datos, el campo "valido" debe ser obligatoriamente false. Si solo hay cambios normales y observaciones menores, "valido" puede ser true.`;

// ─── Cliente OpenRouter (Ideal para cuentas gratuitas sin límites agresivos) ──
async function llamarAOpenRouter(
  apiKey: string,
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<string> {
  const modelName = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash:free";

  const requestCompletion = async (selectedModel: string) => {
    const userPrompt = `Archivo: ${nombreArchivo}

=== ARCHIVO ANTIGUO (producción actual) ===
${contenidoAntiguo}

=== ARCHIVO NUEVO (a desplegar) ===
${contenidoNuevo}

Analiza las diferencias y responde en JSON.`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-Title": "ValidaDoc",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Retornar objeto de error estructurado
      return JSON.stringify({ error: true, status: response.status, message: errorText });
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  };

  let result = await requestCompletion(modelName);
  
  // Si da error 404 (modelo descontinuado/no encontrado) y no estábamos usando el de fallback
  if (result.startsWith('{"error":true') && modelName !== "google/gemini-2.5-flash:free") {
    const errorObj = JSON.parse(result);
    if (errorObj.status === 404) {
      console.warn(`[OpenRouter] Modelo ${modelName} no encontrado (404). Reintentando con fallback google/gemini-2.5-flash:free...`);
      result = await requestCompletion("google/gemini-2.5-flash:free");
    }
  }

  // Si a pesar del fallback sigue habiendo error, lanzar la excepción
  if (result.startsWith('{"error":true')) {
    const errorObj = JSON.parse(result);
    throw new Error(`Error de OpenRouter API (${errorObj.status}): ${errorObj.message}`);
  }

  return result;
}

// ─── Cliente Groq (Llama) ───────────────────────────────────────────────────
async function llamarAGroq(
  apiKey: string,
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<string> {
  const modelName = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const userPrompt = `Archivo: ${nombreArchivo}

=== ARCHIVO ANTIGUO (producción actual) ===
${contenidoAntiguo}

=== ARCHIVO NUEVO (a desplegar) ===
${contenidoNuevo}

Analiza las diferencias y responde en JSON.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error de Groq API (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Cliente Gemini ──────────────────────────────────────────────────────────
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Configura una clave de API (OPENROUTER_API_KEY, GEMINI_API_KEY o GROQ_API_KEY) en tu .env.local para validar."
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

async function llamarAGemini(
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<string> {
  const genAI = getGeminiClient();
  const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  const runGeneration = async (selectedModel: string) => {
    const apiVersion = selectedModel.includes("2.0") ? "v1beta" : "v1";
    const model = genAI.getGenerativeModel(
      {
        model: selectedModel,
        generationConfig: { temperature: 0.1 },
      },
      { apiVersion }
    );

    const userPrompt = `Archivo: ${nombreArchivo}

=== ARCHIVO ANTIGUO (producción actual) ===
${contenidoAntiguo}

=== ARCHIVO NUEVO (a desplegar) ===
${contenidoNuevo}

Analiza las diferencias y responde en JSON.`;

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: userPrompt },
    ]);

    return result.response.text();
  };

  try {
    return await runGeneration(modelName);
  } catch (err: any) {
    const isQuotaOrNotFoundError =
      err?.message?.includes("429") ||
      err?.message?.includes("quota") ||
      err?.message?.includes("404") ||
      err?.message?.includes("not found");

    if (isQuotaOrNotFoundError && modelName !== "gemini-1.5-flash") {
      console.warn(`[Gemini] Error con el modelo ${modelName}. Reintentando con gemini-1.5-flash...`);
      return await runGeneration("gemini-1.5-flash");
    }
    throw err;
  }
}

// ─── Orquestador de validación ────────────────────────────────────────────────
export async function validarConIA(
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<ValidationResult> {
  let responseText = "";
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;

  try {
    if (openrouterApiKey) {
      console.log("[IA] Utilizando OpenRouter API");
      responseText = await llamarAOpenRouter(openrouterApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo);
    } else if (groqApiKey) {
      console.log("[IA] Utilizando Groq API");
      responseText = await llamarAGroq(groqApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo);
    } else {
      console.log("[IA] Utilizando Google Gemini API");
      responseText = await llamarAGemini(contenidoAntiguo, contenidoNuevo, nombreArchivo);
    }

    // Limpieza estándar del JSON por si la IA introduce formato markdown
    const cleaned = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(cleaned) as ValidationResult;

    if (typeof parsed.valido !== "boolean") {
      throw new Error("Respuesta de IA con estructura inválida");
    }

    return {
      valido: parsed.valido,
      errores: Array.isArray(parsed.errores) ? parsed.errores : [],
      advertencias: Array.isArray(parsed.advertencias) ? parsed.advertencias : [],
      resumen: parsed.resumen || "Sin resumen disponible",
    };
  } catch (err: any) {
    console.error("[IA Error]", err);
    return {
      valido: false,
      errores: [
        `Error al conectar o procesar la respuesta de la IA: ${err?.message || "Error desconocido"}`,
      ],
      advertencias: [],
      resumen: "No se pudo completar la validación automática.",
    };
  }
}
