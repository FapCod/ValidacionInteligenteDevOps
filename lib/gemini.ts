// lib/gemini.ts
// Cliente de Google Gemini — SOLO para uso en el servidor (API Routes)
// La GEMINI_API_KEY nunca sale del servidor; el browser nunca la ve.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ValidationResult } from "@/types";

const SYSTEM_PROMPT = `Eres un experto en revisión de código, archivos de configuración (XML, JSON, .env, .config, web.config, appsettings.json) y SQL.

Tu tarea es comparar un archivo de configuración ANTIGUO con uno NUEVO y detectar:

1. Errores de sintaxis (tags XML sin cerrar, JSON mal formado, comillas faltantes o de más, comas de más en JSON)
2. Cambios estructurales sospechosos (keys eliminadas, duplicadas, o mal indentadas entre la versión antigua y nueva)
3. Variables o referencias que existen en el archivo antiguo pero desaparecieron en el nuevo sin razón aparente
4. Si hay sentencias SQL o cadenas de conexión, valida que la sintaxis SQL sea correcta y que los parámetros estén completos
5. Valores vacíos o null en campos que antes tenían valor
6. Cambios en URLs, hostnames, puertos o credenciales que podrían indicar un error de configuración de ambiente

Responde ÚNICAMENTE en formato JSON con esta estructura exacta, sin texto adicional, sin markdown, sin backticks:
{
  "valido": true,
  "errores": [],
  "advertencias": [],
  "resumen": "Descripción breve de 1-2 líneas sobre los cambios detectados"
}

Si hay errores críticos, "valido" debe ser false. Si solo hay advertencias menores, "valido" puede ser true.`;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY no está definida. Esta clave es exclusiva del servidor."
    );
  }

  // La clave nunca se loguea ni se expone
  return new GoogleGenerativeAI(apiKey);
}

export async function validarConIA(
  contenidoAntiguo: string,
  contenidoNuevo: string,
  nombreArchivo: string
): Promise<ValidationResult> {
  const genAI = getGeminiClient();

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1, // Baja temperatura para respuestas consistentes y precisas
    },
  });

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

  const responseText = result.response.text();

  try {
    // Limpiar posibles backticks o texto extra que Gemini pueda agregar
    const cleaned = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(cleaned) as ValidationResult;

    // Validar estructura mínima esperada
    if (typeof parsed.valido !== "boolean") {
      throw new Error("Respuesta de IA con estructura inválida");
    }

    return {
      valido: parsed.valido,
      errores: Array.isArray(parsed.errores) ? parsed.errores : [],
      advertencias: Array.isArray(parsed.advertencias)
        ? parsed.advertencias
        : [],
      resumen: parsed.resumen || "Sin resumen disponible",
    };
  } catch {
    // Si la IA devuelve algo que no podemos parsear, retornamos error seguro
    return {
      valido: false,
      errores: [
        "Error interno al procesar la respuesta de la IA. Intenta de nuevo.",
      ],
      advertencias: [],
      resumen: "No se pudo completar la validación",
    };
  }
}
