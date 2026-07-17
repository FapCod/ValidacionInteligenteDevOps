// lib/gemini.ts
// Cliente híbrido de Inteligencia Artificial (OpenRouter + Gemini + Groq)
// Prioriza OpenRouter si está configurada la API Key (ideal para grandes volúmenes gratis).
// Si no, recurre a Groq o Google Gemini respectivamente.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { computeDiffWithContext } from "./diff";
import type { DiffLine, ValidationResult } from "@/types";
import { createSupabaseServerClient } from "./supabase";

export const SYSTEM_PROMPT = `Eres un experto senior en revisión de código, archivos de configuración y bases de datos SQL Server. Tu tarea es analizar un archivo o script ANTIGUO (versión actual en producción) contra uno NUEVO (versión que se va a desplegar), y detectar errores humanos comunes antes de que lleguen a producción.

Debes revisar los siguientes tipos de problemas, según el tipo de archivo detectado:

## 1. ARCHIVOS DE CONFIGURACIÓN (web.config, app.config, appsettings.json, .env)

- Detecta tags XML sin cerrar correctamente (falta '/>', falta tag de cierre, comillas sin cerrar)
- Detecta JSON mal formado (comas faltantes o de más, llaves/corchetes sin cerrar, comillas faltantes)
- Detecta keys duplicadas o eliminadas sin intención al comparar antiguo vs nuevo
- Detecta URLs, cadenas de conexión o endpoints que correspondan a ambientes NO productivos (dev, qa, test, ts, ppr, staging, sandbox, local, localhost) cuando el contexto indica que el archivo es para PRODUCCIÓN. Si detectas términos como "qa", "test", "ts-", "ppr", "dev", "staging" en una URL dentro de un archivo que va a producción, esto es un ERROR CRÍTICO y debes advertirlo explícitamente.
- Detecta cambios de tipo de dato o formato inesperados en un value (ej: un puerto que cambió de número a texto)

## 2. SCRIPTS SQL / STORED PROCEDURES

- **Consistencia de atributos en tablas temporales**: Si el script crea o modifica una tabla temporal (#Tabla o ##Tabla) agregando una nueva columna, verifica que TODAS las referencias posteriores a esa tabla temporal (INSERT, SELECT, JOIN, UPDATE) sean consistentes con la nueva estructura. Si se agrega una columna en una definición de tabla temporal pero luego se usa en un INSERT o SELECT sin que exista en todas las instancias/creaciones de esa tabla temporal a lo largo del script, repórtalo como ERROR.
- Si detectas que se usa una columna en un JOIN, WHERE o SELECT que no fue declarada en el CREATE TABLE de la tabla temporal correspondiente, repórtalo como error de referencia a columna inexistente.
- **IMPORTANTE:** NO intentes validar si una columna o tabla existe o no en tablas físicas permanentes de la base de datos (por ejemplo, tablas que empiezan con ODS, DBO, etc., como ODS.CONSULTORA o DBO.PEDIDODD), ya que no posees el esquema de la base de datos física. Limita las validaciones de "referencia inexistente" estrictamente a variables declaradas (@Variable) o columnas de tablas temporales (#Tabla o variables de tipo TABLE @Tabla) que estén explícitamente declaradas en el código. Si tienes dudas sobre una columna en una tabla física, repórtala únicamente como una ADVERTENCIA, nunca como un ERROR CRÍTICO.
- **Compatibilidad de Joins:** Sentencias estándar de unión (JOIN, INNER JOIN, LEFT JOIN, RIGHT JOIN, CROSS JOIN, FULL JOIN, CROSS APPLY, OUTER APPLY) son perfectamente compatibles con todas las versiones de SQL Server. NUNCA las reportes como incompatibilidades de versión.
- **Joins redundantes o no usados:** Si detectas que se ha agregado un JOIN (por ejemplo, LEFT JOIN) pero no se proyectan sus columnas ni se usan en el WHERE, repórtalo únicamente como una ADVERTENCIA/SUGERENCIA de rendimiento. NUNCA lo reportes como un ERROR CRÍTICO, ya que la consulta compila y se ejecuta perfectamente.
- **Compatibilidad de versión como ADVERTENCIA (no bloqueante):** A menos que se trate de un error de sintaxis SQL básico que falle en todas las versiones, los posibles problemas de compatibilidad de versión (por ejemplo, el uso de 'CREATE OR ALTER', 'IIF', 'STRING_AGG', etc.) deben clasificarse SIEMPRE como ADVERTENCIAS (no bloqueantes) y nunca como ERRORES CRÍTICOS.
- **Versión de SQL Server por defecto:** A menos que el archivo contenga un comentario explícito indicando lo contrario, asume siempre que la versión de base de datos de destino es SQL Server 2016 o superior. NUNCA evalúes compatibilidad contra SQL Server 2000, 2005 o 2008 de forma predeterminada.
- Detecta DROP de columnas, tablas o procedimientos que puedan romper referencias existentes en el mismo script o en la comparación con la versión antigua.
- Detecta transacciones sin manejo de errores (BEGIN TRAN sin TRY/CATCH o sin COMMIT/ROLLBACK correspondiente).
- Detecta cambios de tipo de dato en columnas ya existentes que puedan causar truncamiento o pérdida de datos (ej: de NVARCHAR(200) a NVARCHAR(50)).
- **IGNORA EL NOMBRE DEL ARCHIVO:** No valides si el nombre físico del archivo coincide con el Stored Procedure o el objeto SQL declarado adentro. Concéntrate únicamente en el contenido de la consulta y la lógica SQL.

## 3. VALIDACIONES GENERALES (cualquier tipo de archivo)

- Compara estructura antigua vs nueva y señala cualquier eliminación, duplicación o modificación que parezca no intencional
- Si los comentarios o el contexto indican el ambiente de destino, siempre valida que las referencias internas (URLs, connection strings, nombres de servidor) sean coherentes con ese ambiente (IGNORA el nombre del archivo para esto).

## 4. FOCO EN LOS NUEVOS CAMBIOS Y ERRORES PRE-EXISTENTES

- **Tu foco principal de revisión son los cambios introducidos en la versión NUEVA.** Estos se identifican por estar marcados con la etiqueta '[AGREGADO]' o '[ELIMINADO]'.
- **NO reportes advertencias ni errores sobre código que ya existía en la versión ANTIGUA (marcado con la etiqueta '[CONTEXTO]') y que no ha sido alterado en esta versión.**
- Si identificas un error extremadamente grave o crítico en el código antiguo que representa un riesgo inminente de caída en producción, y consideras indispensable reportarlo, **debes obligatoriamente iniciar su descripción con la etiqueta '[Pre-existente]'** (ejemplo: "[Pre-existente] Se seleccionan dos columnas con el mismo alias...").
- Para todo error o advertencia introducido por los nuevos cambios (etiquetas '[AGREGADO]' o '[ELIMINADO]'), **NO utilices** el prefijo '[Pre-existente]'.

## CONTEXTO QUE RECIBIRÁS

Además del archivo antiguo y nuevo, puede que recibas:
- Ambiente de destino (ej: PRD, QA, TS, PPR)
- Versión del motor de base de datos de destino (ej: SQL Server 2016, 2019)
- Tipo de archivo (config, SQL, JSON, etc.)

Usa ese contexto para hacer las validaciones más precisas. Si no te lo proporcionan, infiere el ambiente y la versión a partir de pistas dentro del propio archivo (comentarios, nombres de servidor, etc.), y si no puedes inferirlo, indícalo como advertencia ("no se pudo determinar el ambiente/versión de destino, verificar manualmente").

## FORMATO DE RESPUESTA

Responde ÚNICAMENTE en este formato JSON, sin texto adicional antes o después:

{
  "valido": true/false,
  "errores_criticos": [
    {
      "tipo": "sintaxis | referencia_inexistente | compatibilidad_version | ambiente_incorrecto | seguridad | otro",
      "descripcion": "descripción clara y específica del error, incluyendo línea o fragmento afectado",
      "linea_aproximada": "número o referencia si aplica"
    }
  ],
  "advertencias": [
    {
      "tipo": "sintaxis | referencia_inexistente | compatibilidad_version | ambiente_incorrecto | seguridad | otro",
      "descripcion": "descripción de la advertencia, no bloqueante pero recomendable revisar"
    }
  ],
  "resumen": "resumen ejecutivo de 2-3 líneas sobre el estado general del archivo"
}

Sé estricto pero preciso: no reportes falsos positivos, pero no omitas ningún error que pueda causar una falla en producción. Prioriza siempre los errores que rompan sintaxis o generen incompatibilidad de versión, ya que estos son los más costosos de detectar tarde.`;

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
  const extension = nombreArchivo.split(".").pop()?.toLowerCase();
  const esSql = extension === "sql" || extension === "sp" || extension === "proc";

  // Configuración de contexto (Opción C: incrementado de 4 a 15 líneas para mayor cobertura de joins/alias)
  const contextLines = 15;
  const diffLines = computeDiffWithContext(contenidoAntiguo, contenidoNuevo, contextLines);

  let diffText = diffLines
    .map((line: DiffLine) => {
      const sign = line.type === "added" ? "[AGREGADO]" : line.type === "removed" ? "[ELIMINADO]" : "[CONTEXTO]";
      const oldLineNum = line.lineOld ? `Antiguo L${line.lineOld}` : "";
      const newLineNum = line.lineNew ? `Nuevo L${line.lineNew}` : "";
      const lineNumStr = [oldLineNum, newLineNum].filter(Boolean).join(" -> ");
      
      return `${sign} (${lineNumStr}): ${line.content}`;
    })
    .join("\n");

  const LIMIT_CHARS = 15000;
  if (diffText.length > LIMIT_CHARS) {
    diffText = diffText.slice(0, LIMIT_CHARS) + 
      "\n\n[... DIFERENCIAS ADICIONALES TRUNCADAS POR CAPACIDAD DE LA IA PARA EVITAR TIMEOUTS ...]";
  }

  // IGNORA EL NOMBRE FÍSICO DEL ARCHIVO PARA PREVENIR ALUCINACIONES DE AMBIENTES
  let prompt = `Tipo de Archivo: ${esSql ? "SQL" : extension}\n\n`;

  // Opción B: Si es SQL, incluimos el código completo del archivo nuevo además del diff
  if (esSql) {
    const maxSqlChars = 40000; // Límite de seguridad
    let sqlCompleto = contenidoNuevo;
    if (sqlCompleto.length > maxSqlChars) {
      sqlCompleto = sqlCompleto.slice(0, maxSqlChars) + "\n\n[... CÓDIGO NUEVO TRUNCADO POR TAMAÑO EXCESIVO ...]";
    }

    prompt += `=== CÓDIGO COMPLETO DEL NUEVO ARCHIVO (Para contexto de alias, tablas y tipos) ===\n`;
    prompt += `${sqlCompleto}\n\n`;
    prompt += `=== DIFERENCIAS DETECTADAS (Enfoque de la revisión) ===\n`;
    prompt += `Usa el código completo anterior como contexto para entender los joins y alias, pero enfoca tu análisis únicamente en las diferencias del diff presentadas abajo:\n\n`;
    prompt += `${diffText}\n\n`;
    prompt += `Analiza las diferencias apoyándote en el código completo para identificar errores y responde en JSON.`;
  } else {
    prompt += `A continuación se presentan únicamente las diferencias y los cambios detectados junto con algunas líneas de contexto alrededor de los mismos (rango de 15 líneas).\n\n`;
    prompt += `=== DIFERENCIAS DETECTADAS ===\n`;
    prompt += `${diffText}\n\n`;
    prompt += `Analiza las diferencias apoyándote en el contexto para identificar errores y responde en JSON.`;
  }

  return prompt;
}

interface CompletionSuccess {
  responseText: string;
  modelUsed: string;
}

interface CompletionError {
  error: true;
  status: number;
  message: string;
}

// ─── Cliente OpenRouter ──────────────────────────────────────────────────────
async function llamarAOpenRouter(
  apiKey: string,
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string,
  systemPrompt: string
): Promise<CompletionSuccess> {
  const modelName = process.env.OPENROUTER_MODEL || "openrouter/free";
  const userPrompt = construirUserPrompt(contenidoAntiguo, contenidoNuevo, nombreArchivo);

  const requestCompletion = async (selectedModel: string): Promise<CompletionSuccess | CompletionError> => {
    let intentos = 0;
    const maxIntentos = 3;
    let delayMs = 1500;

    while (intentos < maxIntentos) {
      try {
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
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.1,
          }),
          signal: AbortSignal.timeout(25000), // Evita bloqueos indefinidos si OpenRouter responde lento
        });

        if (response.status === 429 || response.status === 503 || response.status === 502) {
          intentos++;
          if (intentos >= maxIntentos) {
            const errorText = await response.text();
            return { error: true, status: response.status, message: errorText };
          }
          console.warn(`[OpenRouter Retry] Recibido código temporal ${response.status}. Reintentando ${intentos}/${maxIntentos} en ${delayMs}ms...`);
          await delay(delayMs);
          delayMs *= 2;
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          return { error: true, status: response.status, message: errorText };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        return { responseText: content, modelUsed: selectedModel };

      } catch (err: any) {
        intentos++;
        if (intentos >= maxIntentos) {
          throw err;
        }
        console.warn(`[OpenRouter Retry] Fallo de conexión o timeout: ${err?.message || err}. Reintentando ${intentos}/${maxIntentos} en ${delayMs}ms...`);
        await delay(delayMs);
        delayMs *= 2;
      }
    }
    throw new Error("Se superó el límite de reintentos en OpenRouter.");
  };

  let result = await requestCompletion(modelName);
  let finalModel = modelName;
  
  if ('error' in result) {
    const errorObj = result;
    const isQuotaOrNotFoundError = 
      errorObj.status === 429 || 
      errorObj.status === 404 || 
      errorObj.status === 400 || 
      String(errorObj.message).toLowerCase().includes("limit") ||
      String(errorObj.message).toLowerCase().includes("not found");

    if (isQuotaOrNotFoundError) {
      console.warn(`[OpenRouter Diagnosis] Falló el modelo ${modelName}. Motivo: ${errorObj.message}. Consultando catálogo de modelos de OpenRouter...`);
      try {
        const diagResponse = await fetch("https://openrouter.ai/api/v1/models", {
          signal: AbortSignal.timeout(5000)
        });
        if (diagResponse.ok) {
          const diagData = await diagResponse.json();
          const listaModelos = diagData.data ? diagData.data.map((m: any) => m.id) : [];
          console.warn("[OpenRouter Diagnosis] Modelos disponibles en catálogo:", listaModelos.length, "modelos encontrados.");

          const prioridadesOpenRouter = [
            "meta-llama/llama-3.3-70b-instruct:free",
            "meta-llama/llama-3.2-3b-instruct:free",
            "qwen/qwen-2.5-coder-32b-instruct:free",
            "openrouter/free"
          ];

          let modeloAlternativo = "";
          for (const familia of prioridadesOpenRouter) {
            const encontrado = listaModelos.find((m: string) => m === familia);
            if (encontrado) {
              modeloAlternativo = encontrado;
              break;
            }
          }

          if (modeloAlternativo && modeloAlternativo !== modelName) {
            console.warn(`[OpenRouter Diagnosis] Reintentando dinámicamente con modelo gratuito autorizado: ${modeloAlternativo}`);
            const retryResult = await requestCompletion(modeloAlternativo);
            if (!('error' in retryResult)) {
              result = retryResult;
              finalModel = modeloAlternativo;
            }
          }
        } else {
          const errText = await diagResponse.text();
          console.error(`[OpenRouter Diagnosis] Error al consultar catálogo: ${diagResponse.status} - ${errText}`);
        }
      } catch (diagErr) {
        console.error("[OpenRouter Diagnosis] Error en el flujo de diagnóstico:", diagErr);
      }
    }
  }

  // Fallback secundario directo a "openrouter/free" si todavía da error y no estábamos usando "openrouter/free"
  if ('error' in result && modelName !== "openrouter/free") {
    console.warn(`[OpenRouter] Todavía con errores. Reintentando por última vez con fallback por defecto openrouter/free...`);
    const retryResult = await requestCompletion("openrouter/free");
    if (!('error' in retryResult)) {
      result = retryResult;
      finalModel = "openrouter/free";
    }
  }

  if ('error' in result) {
    throw new Error(`Error de OpenRouter API (${result.status}): ${result.message}`);
  }

  return result;
}

// ─── Cliente Groq ────────────────────────────────────────────────────────────
async function llamarAGroq(
  apiKey: string,
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string,
  systemPrompt: string
): Promise<CompletionSuccess> {
  const modelName = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const userPrompt = construirUserPrompt(contenidoAntiguo, contenidoNuevo, nombreArchivo);

  const requestCompletion = async (selectedModel: string): Promise<CompletionSuccess | CompletionError> => {
    let intentos = 0;
    const maxIntentos = 3;
    let delayMs = 1500;

    while (intentos < maxIntentos) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.1,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(25000), // Evita bloqueos indefinidos si Groq responde lento
        });

        if (response.status === 429 || response.status === 503 || response.status === 502) {
          intentos++;
          if (intentos >= maxIntentos) {
            const errorText = await response.text();
            return { error: true, status: response.status, message: errorText };
          }
          console.warn(`[Groq Retry] Recibido código temporal ${response.status}. Reintentando ${intentos}/${maxIntentos} en ${delayMs}ms...`);
          await delay(delayMs);
          delayMs *= 2;
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          return { error: true, status: response.status, message: errorText };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        return { responseText: content, modelUsed: selectedModel };

      } catch (err: any) {
        intentos++;
        if (intentos >= maxIntentos) {
          throw err;
        }
        console.warn(`[Groq Retry] Fallo de conexión o timeout: ${err?.message || err}. Reintentando ${intentos}/${maxIntentos} en ${delayMs}ms...`);
        await delay(delayMs);
        delayMs *= 2;
      }
    }
    throw new Error("Se superó el límite de reintentos en Groq.");
  };

  let result = await requestCompletion(modelName);
  let finalModel = modelName;

  if ('error' in result) {
    const errorObj = result;
    const isQuotaOrNotFoundError = 
      errorObj.status === 429 || 
      errorObj.status === 404 || 
      errorObj.status === 400 || 
      String(errorObj.message).toLowerCase().includes("limit") ||
      String(errorObj.message).toLowerCase().includes("not found");

    if (isQuotaOrNotFoundError) {
      console.warn(`[Groq Diagnosis] Falló el modelo ${modelName}. Motivo: ${errorObj.message}. Consultando modelos disponibles para esta clave API...`);
      try {
        const diagResponse = await fetch("https://api.groq.com/openai/v1/models", {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(5000)
        });

        if (diagResponse.ok) {
          const diagData = await diagResponse.json();
          const listaModelos = diagData.data ? diagData.data.map((m: any) => m.id) : [];
          console.warn("[Groq Diagnosis] Modelos disponibles para esta clave:", listaModelos);

          const prioridadesGroq = [
            "llama-3.3-70b-versatile",
            "llama-3.1-70b-versatile",
            "llama-3.1-8b-instant",
            "mixtral-8x7b-32768",
            "gemma2-9b-it"
          ];

          let modeloAlternativo = "";
          for (const familia of prioridadesGroq) {
            const encontrado = listaModelos.find((m: string) => m === familia);
            if (encontrado) {
              modeloAlternativo = encontrado;
              break;
            }
          }

          if (modeloAlternativo && modeloAlternativo !== modelName) {
            console.warn(`[Groq Diagnosis] Reintentando dinámicamente con modelo listado y autorizado: ${modeloAlternativo}`);
            const retryResult = await requestCompletion(modeloAlternativo);
            if (!('error' in retryResult)) {
              result = retryResult;
              finalModel = modeloAlternativo;
            }
          }
        } else {
          const errText = await diagResponse.text();
          console.error(`[Groq Diagnosis] Error al consultar modelos: ${diagResponse.status} - ${errText}`);
        }
      } catch (diagErr) {
        console.error("[Groq Diagnosis] Error en el flujo de diagnóstico:", diagErr);
      }
    }

    if ('error' in result) {
      throw new Error(`Error de Groq API (${result.status}): ${result.message}`);
    }
  }

  return result;
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
  nombreArchivo: string,
  systemPrompt: string
): Promise<{ responseText: string; modelUsed: string }> {
  const genAI = getGeminiClient();
  // Preferir gemini-2.5-flash como modelo base moderno
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const userPrompt = construirUserPrompt(contenidoAntiguo, contenidoNuevo, nombreArchivo);

  const runGeneration = async (selectedModel: string) => {
    // Las claves de API modernas de Google AI Studio (que inician con 'AQ.') requieren v1beta para rutear correctamente.
    const apiVersion = "v1beta";
    const model = genAI.getGenerativeModel(
      {
        model: selectedModel,
        generationConfig: { temperature: 0.1 },
      },
      { apiVersion }
    );

    let intentos = 0;
    const maxIntentos = 3;
    let delayMs = 1500;

    while (intentos < maxIntentos) {
      try {
        const result = await model.generateContent([
          { text: systemPrompt },
          { text: userPrompt },
        ]);
        return { responseText: result.response.text(), modelUsed: selectedModel };
      } catch (err: any) {
        intentos++;
        const errStr = String(err?.message || err || "").toLowerCase();
        const esTemporal = 
          errStr.includes("429") || 
          errStr.includes("quota") || 
          errStr.includes("503") || 
          errStr.includes("502") || 
          errStr.includes("overloaded") || 
          errStr.includes("busy") ||
          errStr.includes("demand");

        if (esTemporal && intentos < maxIntentos) {
          console.warn(`[Gemini Retry] Error temporal (${err?.message || err}). Reintentando ${intentos}/${maxIntentos} en ${delayMs}ms...`);
          await delay(delayMs);
          delayMs *= 2;
          continue;
        }
        throw err;
      }
    }
    throw new Error("Se superó el límite de reintentos en Google Gemini.");
  };

  try {
    return await runGeneration(modelName);
  } catch (err: any) {
    const errStr = String(err?.message || err || "");
    const isQuotaOrNotFoundError =
      errStr.includes("429") ||
      errStr.includes("quota") ||
      errStr.includes("404") ||
      errStr.includes("not found");

    if (isQuotaOrNotFoundError) {
      console.warn(`[Gemini Diagnosis] Falló el modelo ${modelName}. Motivo: ${errStr}. Consultando modelos autorizados para la clave API...`);
      try {
        const apiKey = process.env.GEMINI_API_KEY || "";
        const diagResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
        if (diagResponse.ok) {
          const diagData = await diagResponse.json();
          const listaModelos = diagData.models ? diagData.models.map((m: any) => m.name) : [];
          console.warn("[Gemini Diagnosis] Modelos disponibles para esta clave:", listaModelos);
          
          // Buscar cualquier versión de flash o pro autorizada en orden de preferencia (modelos activos serie 3.x y 2.x)
          const familiasPreferencia = ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-1.5-flash"];
          let modeloAlternativo = "";
          
          for (const familia of familiasPreferencia) {
            const encontrado = listaModelos.find((m: string) => m.includes(familia));
            if (encontrado) {
              modeloAlternativo = encontrado.replace("models/", "");
              break;
            }
          }

          if (modeloAlternativo && modeloAlternativo !== modelName) {
            console.warn(`[Gemini Diagnosis] Reintentando dinámicamente con modelo listado y autorizado: ${modeloAlternativo}`);
            return await runGeneration(modeloAlternativo);
          }
        } else {
          const errText = await diagResponse.text();
          console.error(`[Gemini Diagnosis] Error al consultar modelos: ${diagResponse.status} - ${errText}`);
        }
      } catch (diagErr) {
        console.error("[Gemini Diagnosis] Error en el flujo de diagnóstico:", diagErr);
      }
    }
    throw err;
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Extrae números de línea de las observaciones en varios formatos (ej: "Línea aprox: 99", "Líneas aprox: 72-74", "línea 99")
function extraerNumerosDeLinea(texto: string): number[] {
  const regex = /l[íi]nea[s]?\s*aprox:?\s*([0-9\-\s,y]+)/i;
  const match = texto.match(regex);
  if (!match) {
    const matchSimple = texto.match(/l[íi]nea\s*([0-9]+)/i);
    if (matchSimple) {
      return [parseInt(matchSimple[1], 10)];
    }
    return [];
  }
  
  const numsText = match[1];
  const numeros: number[] = [];
  const parts = numsText.split(/[\s,y\-_]+/); // Separar por guiones, comas o espacios
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (!isNaN(n)) {
      numeros.push(n);
    }
  }
  
  // Si tenía un rango (ej: "72-74" que terminó separado en [72, 74]), rellenar los números intermedios
  if (numeros.length === 2 && numsText.includes("-")) {
    const start = numeros[0];
    const end = numeros[1];
    if (start < end) {
      const rellenos: number[] = [];
      for (let i = start; i <= end; i++) {
        rellenos.push(i);
      }
      return rellenos;
    }
  }
  
  return numeros;
}

// Helper para reescribir errores de referencia física falsos positivos a un formato de sugerencia amigable
function reescribirErrorFisico(errText: string): string {
  const esPreExistente = errText.startsWith("[Pre-existente]") || errText.includes("[Pre-existente]");
  const baseText = esPreExistente ? errText.replace(/^\[Pre-existente\]\s*/i, "").replace(/\[Pre-existente\]/i, "") : errText;

  const regex = /la columna\s+['"]?([a-zA-Z0-9_]+)['"]?\s+no existe\s+en la tabla\s+['"]?([a-zA-Z0-9_.]+)['"]?/i;
  const match = baseText.match(regex);
  
  const prefijo = esPreExistente ? "[Pre-existente] " : "";

  if (match) {
    const columna = match[1];
    const tabla = match[2];
    const lineInfoMatch = baseText.match(/\((Líneas? aprox:.*?)\)/i) || errText.match(/\((Líneas? aprox:.*?)\)/i);
    const lineInfo = lineInfoMatch ? ` (${lineInfoMatch[1]})` : "";
    
    return `[Sugerencia] ${prefijo}Por favor, verifica que la columna '${columna}' exista en la tabla/alias '${tabla}' en la base de datos de destino, ya que es una referencia nueva en este script.${lineInfo}`;
  }
  
  // Fallback si no coincide con el regex exacto
  const limpio = baseText.replace(/^\[.*?\]\s*/, "");
  return `[Sugerencia] ${prefijo}${limpio}`;
}

// Helper para consolidar sugerencias repetidas y agrupar sus líneas en un solo mensaje
function consolidarAdvertencias(advertencias: string[]): string[] {
  const agrupadas = new Map<string, Set<string>>(); // Clave: "tabla.columna.tipo" -> Set de líneas
  const otrasAdvertencias = new Set<string>();

  // Regex que ignora la presencia o no del prefijo [Pre-existente]
  const regexCheck = /^\[Sugerencia\]\s*(?:\[Pre-existente\]\s*)?Por favor, verifica que la columna '([a-zA-Z0-9_]+)' exista en la tabla\/alias '([a-zA-Z0-9_.]+)' en la base de datos de destino/i;

  for (const adv of advertencias) {
    const match = adv.match(regexCheck);
    if (match) {
      const columna = match[1];
      const tabla = match[2];
      const esPreExistente = adv.includes("[Pre-existente]");
      const key = `${tabla}.${columna}.${esPreExistente ? "pre" : "new"}`;

      // Extraer línea si existe
      const lineInfoMatch = adv.match(/\((Líneas? aprox:.*?)\)/i);
      let linea = "";
      if (lineInfoMatch) {
        linea = lineInfoMatch[1].replace(/Líneas? aprox:\s*/i, "").trim();
      }

      if (!agrupadas.has(key)) {
        agrupadas.set(key, new Set<string>());
      }
      if (linea) {
        linea.split(",").forEach(l => agrupadas.get(key)!.add(l.trim()));
      }
    } else {
      otrasAdvertencias.add(adv);
    }
  }

  const resultado: string[] = [];

  // Agregar las agrupadas formateadas
  agrupadas.forEach((lineas, key) => {
    const [tabla, columna, tipo] = key.split(".");
    const esPre = tipo === "pre";
    const lineasArr = Array.from(lineas).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return numA - numB;
    });

    const prefixLinea = lineasArr.length > 1 ? "Líneas" : "Línea";
    const lineasStr = lineasArr.length > 0 
      ? ` (${prefixLinea} aprox: ${lineasArr.join(", ")})` 
      : "";
    
    const prefijoPre = esPre ? "[Pre-existente] " : "";
    
    resultado.push(
      `[Sugerencia] ${prefijoPre}Por favor, verifica que la columna '${columna}' exista en la tabla/alias '${tabla}' en la base de datos de destino, ya que es una referencia nueva en este script.${lineasStr}`
    );
  });

  // Agregar las otras
  otrasAdvertencias.forEach(adv => resultado.push(adv));

  return resultado;
}

// Helper para filtrar advertencias semánticamente duplicadas (desduplicación genérica por palabras clave)
function filtrarDuplicadosSemanticos(advertencias: string[]): string[] {
  const STOP_WORDS = new Set([
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en", "para", "por", "con", "sin", "sobre", "tras", "y", "o", "pero", "mas", "si", "no", "se", "lo", "le", "les", "me", "te", "nos", "os", "mi", "tu", "su", "sus", "como", "que", "al", "es", "son", "fue", "fueron", "ser", "estar", "tiene", "tienen", "existe", "existen", "tabla", "tablas", "columna", "columnas", "base", "datos", "destino", "sugerencia", "error", "advertencia", "aproximada", "linea", "lineas", "aprox", "verificar", "validar", "revisar", "sql", "server", "consulta", "script", "archivo", "nuevo", "antiguo", "agregado", "eliminado", "pre-existente", "despliegue", "produccion", "ambiente", "entorno", "desarrollo", "pruebas", "cambio", "cambios", "codigo", "sintaxis", "ejecucion", "rendimiento", "optimizar", "buena", "practica", "por", "favor", "debe", "deben", "recomienda", "sugiere", "verifica", "indica", "destinado", "utiliza", "construccion"
  ]);

  const obtenerPalabrasClave = (texto: string): Set<string> => {
    const limpio = texto
      .toLowerCase()
      .replace(/[\[\](){}'".,;:\-_?¿!¡+\/=]/g, " ");
    const palabras = limpio.split(/\s+/);
    const keywords = new Set<string>();
    for (const p of palabras) {
      const palabra = p.trim();
      if (palabra.length >= 3 && isNaN(Number(palabra)) && !STOP_WORDS.has(palabra)) {
        keywords.add(palabra);
      }
    }
    return keywords;
  };

  // 1. Clasificar y ordenar las advertencias por orden de relevancia:
  // Primero específicas (con line numbers o prefijos), ordenadas por longitud descendente.
  // Luego genéricas, ordenadas por longitud descendente.
  const clasificadas = advertencias.map(adv => {
    const esEspecifica = 
      adv.includes("[AGREGADO]") || 
      adv.includes("[ELIMINADO]") || 
      adv.includes("[Pre-existente]") || 
      extraerNumerosDeLinea(adv).length > 0;
    return { adv, esEspecifica, length: adv.length };
  });

  clasificadas.sort((a, b) => {
    if (a.esEspecifica && !b.esEspecifica) return -1;
    if (!a.esEspecifica && b.esEspecifica) return 1;
    return b.length - a.length; // El más largo primero para conservar más detalle
  });

  const resultado: string[] = [];
  const conjuntosPalabrasAceptados: Set<string>[] = [];

  // 2. Filtrar por solapamiento de palabras clave
  for (const item of clasificadas) {
    const keywordsActual = obtenerPalabrasClave(item.adv);
    
    if (keywordsActual.size === 0) {
      resultado.push(item.adv);
      continue;
    }

    let esDuplicado = false;
    for (const keywordsAceptadas of conjuntosPalabrasAceptados) {
      let interseccion = 0;
      for (const kw of keywordsActual) {
        if (keywordsAceptadas.has(kw)) {
          interseccion++;
        }
      }

      // Solapamiento respecto al conjunto de palabras de la advertencia analizada
      const porcentajeSolapamiento = interseccion / keywordsActual.size;

      // Si el 60% o más de las palabras clave de esta sugerencia ya están en otra sugerencia más detallada
      if (porcentajeSolapamiento >= 0.60) {
        console.log(`[IA Orquestador] Filtrando duplicado semántico general por solapamiento del ${(porcentajeSolapamiento * 100).toFixed(1)}%: "${item.adv}"`);
        esDuplicado = true;
        break;
      }
    }

    if (!esDuplicado) {
      resultado.push(item.adv);
      conjuntosPalabrasAceptados.push(keywordsActual);
    }
  }

  // Devolver las advertencias aceptadas en su orden original
  return advertencias.filter(adv => resultado.includes(adv));
}

// ─── Orquestador de validación ────────────────────────────────────────────────
export async function validarConIA(
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<ValidationResult> {
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  // 1. Intentar obtener el prompt del sistema de la base de datos (con fallback al estático)
  let activeSystemPrompt = SYSTEM_PROMPT;
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("configuraciones")
      .select("valor")
      .eq("clave", "system_prompt")
      .single();

    if (data?.valor) {
      activeSystemPrompt = data.valor;
    }
  } catch (dbErr) {
    console.warn("[IA Orquestador] No se pudo leer configuraciones de la BD, usando prompt estático por defecto:", dbErr);
  }

  // Definimos la lista de proveedores a consultar en paralelo
  interface ProveedorIA {
    nombre: string;
    ejecutar: () => Promise<{ responseText: string; proveedor: string }>;
  }

  const proveedores: ProveedorIA[] = [];

  if (openrouterApiKey) {
    proveedores.push({
      nombre: "OpenRouter",
      ejecutar: async () => {
        const { responseText, modelUsed } = await llamarAOpenRouter(openrouterApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo, activeSystemPrompt);
        return { responseText, proveedor: `OpenRouter (${modelUsed})` };
      },
    });
  }

  if (geminiApiKey) {
    proveedores.push({
      nombre: "Google Gemini",
      ejecutar: async () => {
        const { responseText, modelUsed } = await llamarAGemini(contenidoAntiguo, contenidoNuevo, nombreArchivo, activeSystemPrompt);
        return { responseText, proveedor: `Google Gemini (${modelUsed})` };
      },
    });
  }

  if (groqApiKey) {
    proveedores.push({
      nombre: "Groq",
      ejecutar: async () => {
        const { responseText, modelUsed } = await llamarAGroq(groqApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo, activeSystemPrompt);
        return { responseText, proveedor: `Groq (${modelUsed})` };
      },
    });
  }

  if (proveedores.length === 0) {
    return {
      valido: false,
      errores: [
        "No se ha configurado ninguna clave de API en el archivo .env.local (OPENROUTER_API_KEY, GROQ_API_KEY o GEMINI_API_KEY).",
      ],
      advertencias: [],
      resumen: "Validación detenida por falta de configuración de IA.",
      proveedor: "Ninguno",
    };
  }

  // Calcular las líneas modificadas reales para determinar automáticamente observaciones pre-existentes
  const diffLinesMod = computeDiffWithContext(contenidoAntiguo, contenidoNuevo, 0);
  const lineasModificadas = new Set<number>();
  for (const line of diffLinesMod) {
    if (line.type === "added" && line.lineNew) {
      lineasModificadas.add(line.lineNew);
    }
  }

  console.log(`[IA Orquestador] Lanzando consultas en paralelo a ${proveedores.length} proveedores...`);

  // Lanzar en paralelo
  const promesas = proveedores.map(p => 
    p.ejecutar()
      .then(res => ({ nombre: p.nombre, success: true as const, res }))
      .catch(err => ({ nombre: p.nombre, success: false as const, error: err?.message || String(err) }))
  );

  const resultados = await Promise.all(promesas);

  const exitosos = resultados.filter(r => r.success);
  const fallidos = resultados.filter(r => !r.success);

  if (exitosos.length === 0) {
    const detallesFallos = fallidos.map(f => `${f.nombre}: ${f.error}`).join(" | ");
    return {
      valido: false,
      errores: [
        `Límite de cuota excedido o saturación de API (429/Too Many Requests): Todos los proveedores de IA fallaron. Detalle: ${detallesFallos}. Por favor, espera un momento antes de reintentar, o configura claves de API de producción con mayor cuota en tu archivo .env.local.`,
      ],
      advertencias: [],
      resumen: "No se pudo completar la validación automática debido a límites de cuota en los proveedores de IA.",
      proveedor: "Todos los proveedores fallaron",
    };
  }

  // Colecciones para consolidar los resultados
  const erroresConsolidados = new Set<string>();
  const advertenciasConsolidadas = new Set<string>();
  const resumenesConsolidados: string[] = [];
  const proveedoresExitosos: string[] = [];

  for (const item of exitosos) {
    const { responseText, proveedor } = item.res;
    proveedoresExitosos.push(proveedor);

    try {
      // Limpieza estándar del JSON
      const cleaned = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const parsed = JSON.parse(cleaned);

      // Convertir el formato de errores
      let erroresLocal: string[] = [];
      const advertenciasAdicionales: string[] = [];

      if (Array.isArray(parsed.errores_criticos)) {
        erroresLocal = parsed.errores_criticos.map((e: any) => {
          const lineInfo = e.linea_aproximada ? ` (Línea aprox: ${e.linea_aproximada})` : "";
          const tipo = e.tipo ? `[${e.tipo.toUpperCase()}] ` : "";
          return `${tipo}${e.descripcion}${lineInfo}`;
        });
      } else if (Array.isArray(parsed.errores)) {
        erroresLocal = parsed.errores.map((e: any) => {
          if (typeof e === "object") {
            const lineInfo = e.linea_aproximada ? ` (Línea aprox: ${e.linea_aproximada})` : "";
            const tipo = e.tipo ? `[${String(e.tipo).toUpperCase()}] ` : "";
            return `${tipo}${e.descripcion || JSON.stringify(e)}${lineInfo}`;
          }
          const strError = String(e);
          if (strError.startsWith("[")) return strError;
          return `[ERROR] ${strError}`;
        });
      }

      // Filtrar y degradar falsos positivos a nivel de string (Capa final de seguridad)
      const erroresFiltrados = erroresLocal.filter((errText: string) => {
        const lowerText = errText.toLowerCase();

        // 1. Falsos positivos de referencia_inexistente en tablas/columnas físicas
        const esReferenciaInexistente = lowerText.includes("referencia_inexistente") || lowerText.includes("no existe");
        if (esReferenciaInexistente) {
          const esTemporalOVariable = lowerText.includes("#") || lowerText.includes("@");
          if (!esTemporalOVariable) {
            console.warn(`[IA Orquestador] Degradando error de referencia física a sugerencia: ${errText}`);
            const reescrito = reescribirErrorFisico(errText);
            advertenciasAdicionales.push(reescrito);
            return false;
          }
        }

        // 2. Falsos positivos de compatibilidad de Joins
        const esCompatibilidad = lowerText.includes("compatibilidad");
        const esJoin = lowerText.includes("join");
        if (esCompatibilidad && esJoin) {
          console.warn(`[IA Orquestador] Degradando error de compatibilidad de join a sugerencia: ${errText}`);
          const limpio = errText.replace(/^\[.*?\]\s*/, "");
          advertenciasAdicionales.push(`[Sugerencia] ${limpio}`);
          return false;
        }

        // 3. Falsos positivos de compatibilidad de versiones (IIF, CREATE OR ALTER, etc.)
        const esCompatibilidadVersion = lowerText.includes("compatibilidad") || lowerText.includes("versión") || lowerText.includes("create or alter") || lowerText.includes("iif") || lowerText.includes("isnull") || lowerText.includes("convert");
        if (esCompatibilidadVersion) {
          console.warn(`[IA Orquestador] Degradando error de compatibilidad de versión a sugerencia: ${errText}`);
          const limpio = errText.replace(/^\[.*?\]\s*/, "");
          advertenciasAdicionales.push(`[Sugerencia] ${limpio}`);
          return false;
        }

        // 4. Falsos positivos de Joins redundantes o no utilizados (deben ser sugerencias, no errores críticos)
        const esJoinRedundante = lowerText.includes("join") && (lowerText.includes("no se utiliza") || lowerText.includes("no es utilizada") || lowerText.includes("redundante") || lowerText.includes("no proyecta") || lowerText.includes("basura") || lowerText.includes("incompleto"));
        if (esJoinRedundante) {
          console.warn(`[IA Orquestador] Degradando error de join redundante a sugerencia: ${errText}`);
          const limpio = errText.replace(/^\[.*?\]\s*/, "");
          advertenciasAdicionales.push(`[Sugerencia] ${limpio}`);
          return false;
        }

        return true;
      }).map((errText: string) => {
        let text = errText;
        const lineasAlerta = extraerNumerosDeLinea(text);
        if (lineasAlerta.length > 0 && !text.includes("[Pre-existente]")) {
          const tieneLineaNueva = lineasAlerta.some(n => lineasModificadas.has(n));
          if (!tieneLineaNueva) {
            text = `[Pre-existente] ${text}`;
          }
        }
        return text;
      }).filter((text: string) => {
        const lower = text.toLowerCase();
        const esPositiva = 
          lower.includes("no se detect") || 
          lower.includes("no se encontr") || 
          lower.includes("no se identific") || 
          lower.includes("no se observ") ||
          lower.includes("no presenta problemas") ||
          lower.includes("no presenta errores") ||
          lower.includes("no contiene problemas") ||
          lower.includes("no contiene errores");
        return !esPositiva;
      });

      // Mapear advertencias locales
      let advertenciasLocal: string[] = [];
      if (Array.isArray(parsed.advertencias)) {
        advertenciasLocal = parsed.advertencias.map((w: any) => {
          let text = "";
          if (typeof w === "object") {
            const tipo = w.tipo ? `[${w.tipo.toUpperCase()}] ` : "";
            const lineInfo = w.linea_aproximada ? ` (Línea aprox: ${w.linea_aproximada})` : "";
            text = `${tipo}${w.descripcion}${lineInfo}`;
          } else {
            text = String(w);
          }

          const lower = text.toLowerCase();
          if (lower.includes("referencia_inexistente") || lower.includes("compatibilidad")) {
            text = reescribirErrorFisico(text);
          }

          // Auto-etiquetar advertencias como pre-existentes si la línea no está modificada en el diff
          const lineasAlerta = extraerNumerosDeLinea(text);
          if (lineasAlerta.length > 0 && !text.includes("[Pre-existente]")) {
            const tieneLineaNueva = lineasAlerta.some(n => lineasModificadas.has(n));
            if (!tieneLineaNueva) {
              text = `[Pre-existente] ${text}`;
            }
          }

          return text;
        }).filter((text: string) => {
          const lower = text.toLowerCase();
          const esPositiva = 
            lower.includes("no se detect") || 
            lower.includes("no se encontr") || 
            lower.includes("no se identific") || 
            lower.includes("no se observ") ||
            lower.includes("no presenta problemas") ||
            lower.includes("no presenta errores") ||
            lower.includes("no contiene problemas") ||
            lower.includes("no contiene errores");
          
          if (esPositiva) {
            console.log(`[IA Orquestador] Filtrando confirmación positiva irrelevante: "${text}"`);
            return false;
          }
          return true;
        });
      }

      // Agregar a colecciones consolidadas
      erroresFiltrados.forEach(err => erroresConsolidados.add(err));
      advertenciasLocal.forEach(adv => advertenciasConsolidadas.add(adv));
      advertenciasAdicionales.forEach(adv => advertenciasConsolidadas.add(adv));

      if (parsed.resumen) {
        resumenesConsolidados.push(`${item.nombre}: ${parsed.resumen}`);
      }

    } catch (parseErr: any) {
      console.error(`[IA Orquestador] Error al procesar respuesta de ${item.nombre}:`, parseErr.message || parseErr);
    }
  }

  const erroresFinales: string[] = [];
  const advertenciasFinales = Array.from(advertenciasConsolidadas);

  // Separar los errores pre-existentes para moverlos a la sección de advertencias no bloqueantes
  for (const err of erroresConsolidados) {
    if (err.includes("[Pre-existente]")) {
      console.warn(`[IA Orquestador] Moviendo error pre-existente a advertencias para no bloquear el despliegue: ${err}`);
      advertenciasFinales.push(err);
    } else {
      erroresFinales.push(err);
    }
  }

  // Unir los resúmenes de los modelos de forma elegante
  const resumenFinal = resumenesConsolidados.length > 0 
    ? resumenesConsolidados.join("\n\n")
    : "Validación completada sin resumen disponible.";

  const proveedorFinal = `Consenso: ${proveedoresExitosos.join(" + ")}`;

  console.log(`[IA Orquestador] Consolidación completada con éxito. Proveedores: ${proveedoresExitosos.join(", ")}`);

  return {
    valido: erroresFinales.length === 0,
    errores: erroresFinales,
    advertencias: filtrarDuplicadosSemanticos(consolidarAdvertencias(advertenciasFinales)),
    resumen: resumenFinal,
    proveedor: proveedorFinal,
  };
}
