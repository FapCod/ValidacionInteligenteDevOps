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

REGLA CRÍTICA DE VALIDACIÓN (DELTA):
- Concéntrate EXCLUSIVAMENTE en los cambios nuevos introducidos en el archivo nuevo (la diferencia/delta).
- Si una advertencia de seguridad, variable vacía (ej: llaves AWS vacías), configuración insegura o hostname ya existía de forma idéntica en el ARCHIVO ANTIGUO, NO lo reportes como advertencia ni error. El objetivo es validar la seguridad e integridad del pase actual, no auditar configuraciones legadas que ya están corriendo y aprobadas en producción.

Si el archivo es un script SQL o un Stored Procedure (SP):
- Debes realizar una validación de consistencia de variables y tablas temporales.
- Si en el código modificado/agregado se hace referencia a una variable (ej: @miVariable) o a una columna de una tabla temporal (ej: #MiTabla.NombreColumna o INSERT INTO #MiTabla (Columna)), debes verificar que dicha variable o columna realmente estén declaradas en las "Declaraciones Globales de Contexto" proporcionadas.
- Si una variable o columna es utilizada pero no aparece declarada en las definiciones del archivo, considéralo un error crítico ("valido": false) especificando qué variable o columna de tabla temporal no ha sido declarada.

Responde ÚNICAMENTE en formato JSON plano con la siguiente estructura exacta. No agregues explicaciones adicionales fuera del JSON, no uses bloques de código con markdown ni backticks:
{
  "valido": true,
  "errores": ["Descripción detallada del error crítico 1", "Descripción detallada del error crítico 2"],
  "advertencias": ["Advertencia menor o sugerencia 1"],
  "resumen": "Resumen profesional de los cambios y hallazgos en 1 o 2 líneas"
}

Si encuentras algún error de sintaxis o inconsistencia crítica que pueda romper el despliegue o la base de datos, el campo "valido" debe ser obligatoriamente false. Si solo hay cambios normales y observaciones menores, "valido" puede ser true.`;

// ─── Extractor de Contexto Declarativo de SQL ─────────────────────────────────
/**
 * Escanea el código SQL en busca de declaraciones de variables y de tablas temporales.
 * Esto se envía como contexto estático a la IA para evitar que declare variables
 * o columnas inexistentes al analizar diffs fragmentados en archivos grandes.
 */
function extraerContextoDeclaracionesSql(sqlText: string): string {
  const lines = sqlText.split("\n");
  const declarations: string[] = [];
  let inCreateTableBlock = false;
  let currentTableBlock = "";

  for (let line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();

    // 1. Capturar declaraciones simples: DECLARE @Variable TipoData
    if (upper.startsWith("DECLARE @") && !upper.includes(" TABLE")) {
      declarations.push(trimmed);
      continue;
    }

    // 2. Capturar inicio de tabla temporal o variable tipo TABLE
    const isStartTable = upper.startsWith("CREATE TABLE #") || (upper.startsWith("DECLARE @") && upper.includes(" TABLE"));
    if (isStartTable) {
      inCreateTableBlock = true;
      currentTableBlock = trimmed;
      // Si la declaración de tabla se cierra en la misma línea
      if (trimmed.endsWith(")") || trimmed.endsWith(");")) {
        declarations.push(currentTableBlock);
        inCreateTableBlock = false;
        currentTableBlock = "";
      }
      continue;
    }

    // 3. Acumular líneas del bloque de definición de tabla hasta su cierre
    if (inCreateTableBlock) {
      currentTableBlock += "\n  " + trimmed;
      if (trimmed.startsWith(")") || trimmed.endsWith(")") || trimmed.endsWith(");")) {
        declarations.push(currentTableBlock);
        inCreateTableBlock = false;
        currentTableBlock = "";
      }
    }
  }

  if (declarations.length === 0) return "";
  return declarations.join("\n\n");
}

// ─── Optimizador de Tokens (Reducción inteligente de tamaño) ──────────────────
function construirUserPrompt(
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): string {
  const combinadaLen = contenidoAntiguo.length + contenidoNuevo.length;
  const LIMIT_CHARS = 10000; // ~2,500 tokens máximo
  const extension = nombreArchivo.split(".").pop()?.toLowerCase();
  const esSql = extension === "sql" || extension === "sp" || extension === "proc";

  // Extraer declaraciones de SQL en caso de que sea un script SQL
  let sqlContext = "";
  if (esSql) {
    sqlContext = extraerContextoDeclaracionesSql(contenidoNuevo);
  }

  // Siempre extraemos únicamente las diferencias y su contexto.
  // Esto previene que la IA analice u observe código preexistente/heredado que no ha cambiado.
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

  let prompt = `Archivo: ${nombreArchivo}

A continuación se presentan únicamente las diferencias y los cambios detectados junto con algunas líneas de contexto alrededor de los mismos.`;

  // Si es SQL, inyectar el contexto estático de declaraciones que extrajimos de todo el archivo
  if (esSql && sqlContext) {
    prompt += `\n\n=== DECLARACIONES GLOBALES DE CONTEXTO (Tablas temporales y variables declaradas en el archivo) ===
${sqlContext}

(Utiliza estas definiciones para validar que cualquier variable o columna temporal utilizada en el diff realmente exista y esté declarada en el archivo. Si en el diff se inserta en una tabla temporal, valida que coincida con las columnas definidas arriba).`;
  }

  prompt += `\n\n=== DIFERENCIAS DETECTADAS ===
${diffText}

Analiza las diferencias apoyándote en el contexto para identificar errores y responde en JSON.`;

  return prompt;
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
  let proveedor = "Google Gemini";

  try {
    if (openrouterApiKey) {
      const model = process.env.OPENROUTER_MODEL || "openrouter/free";
      proveedor = `OpenRouter (${model})`;
      console.log(`[IA] Utilizando OpenRouter API: ${model}`);
      responseText = await llamarAOpenRouter(openrouterApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo);
    } else if (groqApiKey) {
      const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
      proveedor = `Groq (${model})`;
      console.log(`[IA] Utilizando Groq API: ${model}`);
      responseText = await llamarAGroq(groqApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo);
    } else {
      const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
      proveedor = `Google Gemini (${model})`;
      console.log(`[IA] Utilizando Google Gemini API: ${model}`);
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
      proveedor,
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
      proveedor,
    };
  }
}
