// lib/gemini.ts
// Cliente híbrido de Inteligencia Artificial (OpenRouter + Gemini + Groq)
// Prioriza OpenRouter si está configurada la API Key (ideal para grandes volúmenes gratis).
// Si no, recurre a Groq o Google Gemini respectivamente.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { computeDiffWithContext } from "./diff";
import type { DiffLine, ValidationResult } from "@/types";

const SYSTEM_PROMPT = `Eres un experto senior en revisión de código, archivos de configuración y bases de datos SQL Server. Tu tarea es analizar un archivo o script ANTIGUO (versión actual en producción) contra uno NUEVO (versión que se va a desplegar), y detectar errores humanos comunes antes de que lleguen a producción.

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

  let diffText = diffLines
    .map((line: DiffLine) => {
      const sign = line.type === "added" ? "[AGREGADO]" : line.type === "removed" ? "[ELIMINADO]" : "[CONTEXTO]";
      const oldLineNum = line.lineOld ? `Antiguo L${line.lineOld}` : "";
      const newLineNum = line.lineNew ? `Nuevo L${line.lineNew}` : "";
      const lineNumStr = [oldLineNum, newLineNum].filter(Boolean).join(" -> ");
      
      return `${sign} (${lineNumStr}): ${line.content}`;
    })
    .join("\n");

  // Truncado de seguridad para controlar el consumo de tokens y prevenir timeouts en archivos masivos.
  // LIMIT_CHARS (~12,000 caracteres) garantiza que la petición de tokens esté siempre por debajo del límite de Groq/OpenRouter.
  if (diffText.length > LIMIT_CHARS) {
    diffText = diffText.slice(0, LIMIT_CHARS) + 
      "\n\n[... DIFERENCIAS ADICIONALES TRUNCADAS POR CAPACIDAD DE LA IA PARA EVITAR TIMEOUTS ...]";
  }

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
      { text: SYSTEM_PROMPT },
      { text: userPrompt },
    ]);

    return result.response.text();
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
          
          // Buscar cualquier versión de flash o pro autorizada en orden de preferencia
          const familiasPreferencia = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-1.5-flash"];
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

// ─── Orquestador de validación ────────────────────────────────────────────────
export async function validarConIA(
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<ValidationResult> {
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  // Definimos la lista de intentos estructurada con sus prioridades y claves
  interface IntentoIA {
    nombre: string;
    ejecutar: () => Promise<{ responseText: string; proveedor: string }>;
  }

  const colaIntentos: IntentoIA[] = [];

  if (geminiApiKey) {
    colaIntentos.push({
      nombre: "Google Gemini",
      ejecutar: async () => {
        const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
        const res = await llamarAGemini(contenidoAntiguo, contenidoNuevo, nombreArchivo);
        return { responseText: res, proveedor: `Google Gemini (${model})` };
      },
    });
  }

  if (groqApiKey) {
    colaIntentos.push({
      nombre: "Groq",
      ejecutar: async () => {
        const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
        const res = await llamarAGroq(groqApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo);
        return { responseText: res, proveedor: `Groq (${model})` };
      },
    });
  }

  if (openrouterApiKey) {
    colaIntentos.push({
      nombre: "OpenRouter",
      ejecutar: async () => {
        const model = process.env.OPENROUTER_MODEL || "openrouter/free";
        const res = await llamarAOpenRouter(openrouterApiKey, contenidoAntiguo, contenidoNuevo, nombreArchivo);
        return { responseText: res, proveedor: `OpenRouter (${model})` };
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
      if (Array.isArray(parsed.errores_criticos)) {
        errores = parsed.errores_criticos.map((e: any) => {
          const lineInfo = e.linea_aproximada ? ` (Línea aprox: ${e.linea_aproximada})` : "";
          const tipo = e.tipo ? `[${e.tipo.toUpperCase()}] ` : "";
          return `${tipo}${e.descripcion}${lineInfo}`;
        });
      } else if (Array.isArray(parsed.errores)) {
        errores = parsed.errores.map((e: any) => typeof e === "object" ? `${e.descripcion || JSON.stringify(e)}` : String(e));
      }

      let advertencias: string[] = [];
      if (Array.isArray(parsed.advertencias)) {
        advertencias = parsed.advertencias.map((w: any) => {
          if (typeof w === "object") {
            const tipo = w.tipo ? `[${w.tipo.toUpperCase()}] ` : "";
            const lineInfo = w.linea_aproximada ? ` (Línea aprox: ${w.linea_aproximada})` : "";
            return `${tipo}${w.descripcion}${lineInfo}`;
          }
          return String(w);
        });
      }

      console.log(`[IA Orquestador] validación completada con éxito por: ${intento.nombre}`);
      return {
        valido: parsed.valido,
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
