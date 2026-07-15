// lib/gemini.ts
// Cliente híbrido de Inteligencia Artificial (OpenRouter + Gemini + Groq)
// Prioriza OpenRouter si está configurada la API Key (ideal para grandes volúmenes gratis).
// Si no, recurre a Groq o Google Gemini respectivamente.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { computeDiffWithContext } from "./diff";
import type { DiffLine, ValidationResult } from "@/types";

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

// ─── Optimizador de Tokens (Reducción inteligente de tamaño) ──────────────────
function construirUserPrompt(
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): string {
  const combinadaLen = contenidoAntiguo.length + contenidoNuevo.length;
  const LIMIT_CHARS = 10000; // ~2,500 tokens máximo para evitar cuotas TPM bajas en Free Tiers

  if (combinadaLen < LIMIT_CHARS) {
    // Si el archivo es pequeño, enviarlo completo para un contexto del 100%
    return `Archivo: ${nombreArchivo}

=== ARCHIVO ANTIGUO (producción actual) ===
${contenidoAntiguo}

=== ARCHIVO NUEVO (a desplegar) ===
${contenidoNuevo}

Analiza los archivos completos y responde en JSON.`;
  }

  // Si el archivo es muy grande, extraer solo las diferencias y su contexto.
  // Esto reduce el consumo de tokens en un ~90% de forma instantánea.
  console.log(`[IA] Archivo grande (${(combinadaLen / 1024).toFixed(1)} KB). Extrayendo diff con contexto para optimizar tokens...`);
  const diffLines = computeDiffWithContext(contenidoAntiguo, contenidoNuevo, 4);

  const diffText = diffLines
    .map((line: DiffLine) => {
      const sign = line.type === "added" ? "[AGREGADO]" : line.type === "removed" ? "[ELIMINADO]" : "[CONTEXTO]";
      const oldLineNum = line.lineOld ? `Antiguo L${line.lineOld}` : "";
      const newLineNum = line.lineNew ? `Nuevo L${line.lineNew}` : "";
      const lineNumStr = [oldLineNum, newLineNum].filter(Boolean).join(" -> ");
      
      return `${sign} (${lineNumStr}): ${line.content}`;
    })
    .join("\n");

  return `Archivo: ${nombreArchivo}

El archivo es demasiado grande para procesarlo completo en el plan gratuito. A continuación se presentan únicamente las diferencias y los cambios detectados junto con algunas líneas de contexto alrededor de los mismos.

=== DIFERENCIAS DETECTADAS ===
${diffText}

Analiza estas diferencias y su contexto para identificar errores y responde en JSON.`;
}

// ─── Cliente OpenRouter ──────────────────────────────────────────────────────
async function llamarAOpenRouter(
  apiKey: string,
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<string> {
  const modelName = process.env.OPENROUTER_MODEL || "openrouter/free";
  const userPrompt = construirUserPrompt(contenidoAntiguo, contenidoNuevo, nombreArchivo);

  const requestCompletion = async (selectedModel: string) => {
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
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return JSON.stringify({ error: true, status: response.status, message: errorText });
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  };

  let result = await requestCompletion(modelName);
  
  if (result.startsWith('{"error":true') && modelName !== "openrouter/free") {
    const errorObj = JSON.parse(result);
    if (errorObj.status === 404) {
      console.warn(`[OpenRouter] Modelo ${modelName} no encontrado (404). Reintentando con fallback openrouter/free...`);
      result = await requestCompletion("openrouter/free");
    }
  }

  if (result.startsWith('{"error":true')) {
    const errorObj = JSON.parse(result);
    throw new Error(`Error de OpenRouter API (${errorObj.status}): ${errorObj.message}`);
  }

  return result;
}

// ─── Cliente Groq ────────────────────────────────────────────────────────────
async function llamarAGroq(
  apiKey: string,
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<string> {
  const modelName = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const userPrompt = construirUserPrompt(contenidoAntiguo, contenidoNuevo, nombreArchivo);

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
  const userPrompt = construirUserPrompt(contenidoAntiguo, contenidoNuevo, nombreArchivo);

  const runGeneration = async (selectedModel: string) => {
    const apiVersion = selectedModel.includes("2.0") ? "v1beta" : "v1";
    const model = genAI.getGenerativeModel(
      {
        model: selectedModel,
        generationConfig: { temperature: 0.1 },
      },
      { apiVersion }
    );

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
