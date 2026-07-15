// app/api/validar/route.ts
// Endpoint POST /api/validar
// Seguridad:
//  - JWT verificado server-side (requireAuth)
//  - usuario_id extraído del JWT, nunca del body
//  - GEMINI_API_KEY nunca llega al cliente
//  - Rate limiting por usuario
//  - Límite de tamaño de archivo

// Fuerza modo dinámico: esta ruta no se pre-renderiza en build time
// (requiere variables de entorno que solo existen en runtime)
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { validarConIA } from "@/lib/gemini";
import { checkRateLimit } from "@/lib/rateLimit";
import { createSupabaseServerClient } from "@/lib/supabase";
import { validarXml } from "@/lib/xmlValidator";
import type { ValidarRequestBody } from "@/types";

const MAX_FILE_SIZE_BYTES = 200 * 1024; // 200KB por archivo

export async function POST(request: NextRequest) {
  // 1. Verificar autenticación — usuario_id viene del JWT, no del body
  let user: { id: string; email: string };
  try {
    user = await requireAuth(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    return NextResponse.json({ error: "Error de autenticación" }, { status: 401 });
  }

  // 2. Rate limiting por usuario
  const { allowed, remaining, resetInSeconds } = checkRateLimit(user.id);
  if (!allowed) {
    return NextResponse.json(
      {
        error: `Límite de validaciones alcanzado. Intenta en ${resetInSeconds} segundos.`,
        code: "RATE_LIMIT_EXCEEDED",
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetInSeconds),
        },
      }
    );
  }

  // 3. Parsear y validar el body
  let body: ValidarRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { nombre_archivo, contenido_antiguo, contenido_nuevo } = body;

  if (!nombre_archivo || !contenido_antiguo || !contenido_nuevo) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: nombre_archivo, contenido_antiguo, contenido_nuevo" },
      { status: 400 }
    );
  }

  // 4. Límite de tamaño de archivo (200KB)
  const encoder = new TextEncoder();
  if (
    encoder.encode(contenido_antiguo).length > MAX_FILE_SIZE_BYTES ||
    encoder.encode(contenido_nuevo).length > MAX_FILE_SIZE_BYTES
  ) {
    return NextResponse.json(
      { error: "El archivo excede el límite máximo de 200KB" },
      { status: 413 }
    );
  }

  // 5. Sanitizar nombre de archivo
  const nombreSanitizado = nombre_archivo
    .replace(/[^a-zA-Z0-9.\-_\s]/g, "")
    .slice(0, 255);

  const extension = nombreSanitizado.split(".").pop()?.toLowerCase();

  // ─── Validación Sintáctica Local Determinista (JSON y XML) ───────────────
  // Si el archivo está físicamente roto a nivel de estructura, no es necesario llamar a la IA.
  if (extension === "json" || contenido_nuevo.trim().startsWith("{") || contenido_nuevo.trim().startsWith("[")) {
    try {
      JSON.parse(contenido_nuevo);
    } catch (jsonErr: any) {
      const errorMsg = jsonErr?.message || "JSON mal formado.";
      return NextResponse.json({
        valido: false,
        errores: [`Error de sintaxis JSON crítico: ${errorMsg}`],
        advertencias: [],
        resumen: "El archivo nuevo no es un JSON válido.",
      });
    }
  }

  const esXml = extension === "xml" || 
                extension === "config" || 
                extension === "web.config" || 
                contenido_nuevo.trim().startsWith("<?xml") || 
                contenido_nuevo.trim().startsWith("<configuration");

  if (esXml) {
    const xmlCheck = validarXml(contenido_nuevo);
    if (!xmlCheck.valido) {
      return NextResponse.json({
        valido: false,
        errores: [`Error de sintaxis XML crítico: ${xmlCheck.error}`],
        advertencias: [],
        resumen: "El archivo nuevo no es un documento XML bien formado.",
      });
    }
  }

  // 6. Llamar a la IA (server → IA, el browser no participa)
  let resultadoIA;
  try {
    resultadoIA = await validarConIA(
      contenido_antiguo,
      contenido_nuevo,
      nombreSanitizado
    );
  } catch (err) {
    console.error("[/api/validar] Error llamando a Gemini:", err);
    const mensajeError = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      { error: `Error al conectar con el servicio de IA: ${mensajeError}` },
      { status: 502 }
    );
  }

  // 7. Guardar en Supabase usando service_role (bypasea RLS para inserción server-side)
  const supabase = createSupabaseServerClient();
  const { error: dbError } = await supabase.from("validaciones").insert({
    usuario_id: user.id, // Siempre del JWT verificado
    nombre_archivo: nombreSanitizado,
    contenido_antiguo,
    contenido_nuevo,
    resultado_ia: resultadoIA,
    es_valido: resultadoIA.valido,
  });

  if (dbError) {
    console.error("[/api/validar] Error guardando en BD:", dbError.message);
    // Retornamos el resultado de IA de todas formas aunque falle el guardado
    // El usuario recibe su resultado; el error de BD es interno
  }

  // 8. Responder sin exponer datos internos
  return NextResponse.json(resultadoIA, {
    status: 200,
    headers: {
      "X-RateLimit-Remaining": String(remaining),
    },
  });
}

// Solo se acepta POST
export async function GET() {
  return NextResponse.json({ error: "Método no permitido" }, { status: 405 });
}
