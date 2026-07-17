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
- **Compatibilidad de Joins:** Sentencias estándar de unión (JOIN, INNER JOIN, LEFT JOIN, RIGHT JOIN, CROSS JOIN, FULL JOIN, CROSS APPLY, OUTER APPLY) son perfectamente compatibles con todas las versiones de SQL Server (desde SQL Server 2000 en adelante). NUNCA las reportes como incompatibilidades de versión.
- Detecta sentencias 'CREATE OR ALTER' y advierte que esta sintaxis solo es compatible con SQL Server 2016 SP1 en adelante. Si el contexto o la configuración indica que el servidor de destino es una versión anterior (ej. SQL Server 2012, 2014, o 2016 sin SP1), márcalo como ERROR CRÍTICO de compatibilidad.
- Detecta el uso de funciones o sintaxis específicas de versiones nuevas (ej: STRING_AGG requiere 2017+, funciones JSON requieren 2016+, DROP TABLE IF EXISTS requiere 2016+) y valida contra la versión de destino indicada.
- Detecta DROP de columnas, tablas o procedimientos que puedan romper referencias existentes en el mismo script o en la comparación con la versión antigua.
- Detecta transacciones sin manejo de errores (BEGIN TRAN sin TRY/CATCH o sin COMMIT/ROLLBACK correspondiente).
- Detecta cambios de tipo de dato en columnas ya existentes que puedan causar truncamiento o pérdida de datos (ej: de NVARCHAR(200) a NVARCHAR(50)).

## 3. VALIDACIONES GENERALES (cualquier tipo de archivo)

- Compara estructura antigua vs nueva y señala cualquier eliminación, duplicación o modificación que parezca no intencional
- Si el nombre del archivo, comentarios, o contexto indican el ambiente de destino, siempre valida que las referencias internas (URLs, connection strings, nombres de servidor) sean coherentes con ese ambiente

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

  let prompt = `Archivo: ${nombreArchivo}\n\n`;

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

    if (!response.ok) {
      const errorText = await response.text();
      return { error: true, status: response.status, message: errorText };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    return { responseText: content, modelUsed: selectedModel };
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
            "google/gemini-2.5-flash:free",
            "google/gemini-2.0-flash-exp:free",
            "meta-llama/llama-3.1-8b-instruct:free",
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

    if (!response.ok) {
      const errorText = await response.text();
      return { error: true, status: response.status, message: errorText };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    return { responseText: content, modelUsed: selectedModel };
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

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt },
    ]);

    return { responseText: result.response.text(), modelUsed: selectedModel };
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

// Helper para reescribir errores de referencia física falsos positivos a un formato de sugerencia amigable
function reescribirErrorFisico(errText: string): string {
  const regex = /la columna\s+['"]?([a-zA-Z0-9_]+)['"]?\s+no existe\s+en la tabla\s+['"]?([a-zA-Z0-9_.]+)['"]?/i;
  const match = errText.match(regex);
  
  if (match) {
    const columna = match[1];
    const tabla = match[2];
    const lineInfoMatch = errText.match(/\((Línea aprox:.*?)\)/i);
    const lineInfo = lineInfoMatch ? ` (${lineInfoMatch[1]})` : "";
    
    return `[Sugerencia] Por favor, verifica que la columna '${columna}' exista en la tabla/alias '${tabla}' en la base de datos de destino, ya que es una referencia nueva en este script.${lineInfo}`;
  }
  
  // Fallback si no coincide con el regex exacto
  const limpio = errText.replace(/^\[.*?\]\s*/, "");
  return `[Sugerencia] ${limpio}`;
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

  // Definimos la lista de intentos estructurada con sus prioridades y claves
  interface IntentoIA {
    nombre: string;
    ejecutar: () => Promise<{ responseText: string; proveedor: string }>;
  }

  const colaIntentos: IntentoIA[] = [];

  // Prioridad 1: OpenRouter (Gemini / Llama a través de OpenRouter)
  if (openrouterApiKey) {
    colaIntentos.push({
      nombre: "OpenRouter",
      ejecutar: async () => {
        const { responseText, modelUsed } = await llamarAOpenRouter(openrouterApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo, activeSystemPrompt);
        return { responseText, proveedor: `OpenRouter (${modelUsed})` };
      },
    });
  }

  // Prioridad 2: Google Gemini (Directo)
  if (geminiApiKey) {
    colaIntentos.push({
      nombre: "Google Gemini",
      ejecutar: async () => {
        const { responseText, modelUsed } = await llamarAGemini(contenidoAntiguo, contenidoNuevo, nombreArchivo, activeSystemPrompt);
        return { responseText, proveedor: `Google Gemini (${modelUsed})` };
      },
    });
  }

  // Prioridad 3: Groq (Fallback final)
  if (groqApiKey) {
    colaIntentos.push({
      nombre: "Groq",
      ejecutar: async () => {
        const { responseText, modelUsed } = await llamarAGroq(groqApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo, activeSystemPrompt);
        return { responseText, proveedor: `Groq (${modelUsed})` };
      },
    });
  }

  if (colaIntentos.length === 0) {
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

  const erroresAcumulados: string[] = [];

  // Ejecución secuencial (Fallback en cadena)
  for (const intento of colaIntentos) {
    try {
      console.log(`[IA Orquestador] Intentando validación con proveedor: ${intento.nombre}...`);
      const { responseText, proveedor } = await intento.ejecutar();

      // Limpieza estándar del JSON por si la IA introduce formato markdown
      const cleaned = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const parsed = JSON.parse(cleaned);

      if (typeof parsed.valido !== "boolean") {
        throw new Error("Respuesta de IA con estructura de JSON inválida");
      }

      // Convertir el formato extendido de errores y advertencias al formato clásico
      let errores: string[] = [];
      const advertenciasAdicionales: string[] = [];

      if (Array.isArray(parsed.errores_criticos)) {
        errores = parsed.errores_criticos.map((e: any) => {
          const lineInfo = e.linea_aproximada ? ` (Línea aprox: ${e.linea_aproximada})` : "";
          const tipo = e.tipo ? `[${e.tipo.toUpperCase()}] ` : "";
          return `${tipo}${e.descripcion}${lineInfo}`;
        });
      } else if (Array.isArray(parsed.errores)) {
        errores = parsed.errores.map((e: any) => {
          if (typeof e === "object") {
            const lineInfo = e.linea_aproximada ? ` (Línea aprox: ${e.linea_aproximada})` : "";
            const tipo = e.tipo ? `[${String(e.tipo).toUpperCase()}] ` : "";
            return `${tipo}${e.descripcion || JSON.stringify(e)}${lineInfo}`;
          }
          const strError = String(e);
          // Si el texto ya tiene un tipo entre corchetes, no lo duplicamos
          if (strError.startsWith("[")) {
            return strError;
          }
          return `[ERROR] ${strError}`;
        });
      }

      // Filtrar y degradar falsos positivos a nivel de string (Capa final de seguridad)
      const erroresFiltrados = errores.filter((errText: string) => {
        const lowerText = errText.toLowerCase();

        // 1. Falsos positivos de referencia_inexistente en tablas/columnas físicas
        const esReferenciaInexistente = lowerText.includes("referencia_inexistente") || lowerText.includes("no existe");
        if (esReferenciaInexistente) {
          const esTemporalOVariable = lowerText.includes("#") || lowerText.includes("@");
          if (!esTemporalOVariable) {
            console.warn(`[IA Orquestador] Degradando error de referencia física a sugerencia: ${errText}`);
            const reescrito = reescribirErrorFisico(errText);
            advertenciasAdicionales.push(reescrito);
            return false; // Se remueve de errores críticos
          }
        }

        // 2. Falsos positivos de compatibilidad de Joins
        const esCompatibilidad = lowerText.includes("compatibilidad");
        const esJoin = lowerText.includes("join");
        if (esCompatibilidad && esJoin) {
          console.warn(`[IA Orquestador] Degradando error de compatibilidad de join a sugerencia: ${errText}`);
          const limpio = errText.replace(/^\[.*?\]\s*/, "");
          advertenciasAdicionales.push(`[Sugerencia] ${limpio}`);
          return false; // Se remueve de errores críticos
        }

        return true;
      });

      errores = erroresFiltrados;

      let advertencias: string[] = [];
      if (Array.isArray(parsed.advertencias)) {
        advertencias = parsed.advertencias.map((w: any) => {
          let text = "";
          if (typeof w === "object") {
            const tipo = w.tipo ? `[${w.tipo.toUpperCase()}] ` : "";
            const lineInfo = w.linea_aproximada ? ` (Línea aprox: ${w.linea_aproximada})` : "";
            text = `${tipo}${w.descripcion}${lineInfo}`;
          } else {
            text = String(w);
          }

          // Limpiar prefijos de tipo de error confuso en las advertencias
          const lower = text.toLowerCase();
          if (lower.includes("referencia_inexistente") || lower.includes("compatibilidad")) {
            return reescribirErrorFisico(text);
          }
          return text;
        });
      }

      // Combinar con las advertencias adicionales degradadas
      advertencias = [...advertencias, ...advertenciasAdicionales];

      console.log(`[IA Orquestador] validación completada con éxito por: ${intento.nombre}`);
      return {
        valido: errores.length === 0,
        errores,
        advertencias,
        resumen: parsed.resumen || "Sin resumen disponible",
        proveedor,
      };
    } catch (err: any) {
      const msg = err?.message || "Error desconocido";
      console.warn(`[IA Orquestador] Falló ${intento.nombre}: ${msg}. Intentando siguiente proveedor...`);
      erroresAcumulados.push(`${intento.nombre}: ${msg}`);
    }
  }

  // Si llegamos aquí es porque TODOS los proveedores de la cola fallaron
  return {
    valido: false,
    errores: [
      "Todos los proveedores de IA configurados fallaron o excedieron sus cuotas:",
      ...erroresAcumulados.map((e) => `• ${e}`),
    ],
    advertencias: [],
    resumen: "No se pudo completar la validación automática con ningún proveedor de IA.",
    proveedor: "Todos los proveedores fallaron",
  };
}
