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

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB por archivo

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

  // 2.5 Verificar si el usuario tiene permitido validar con IA
  const supabase = createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase
    .from("usuarios")
    .select("puede_validar_ia")
    .eq("id", user.id)
    .single();

  if (userError || !userData) {
    console.error("[/api/validar] Error al consultar puede_validar_ia:", userError?.message);
    return NextResponse.json({ error: "Error al verificar permisos del usuario." }, { status: 500 });
  }

  if (!userData.puede_validar_ia) {
    return NextResponse.json(
      { error: "Tu usuario no tiene permitido validar con IA. Por favor, contacta a un administrador." },
      { status: 403 }
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
      { error: "El archivo excede el límite máximo de 10MB" },
      { status: 413 }
    );
  }

  // 5. Sanitizar nombre de archivo
  const nombreSanitizado = nombre_archivo
    .replace(/[^a-zA-Z0-9.\-_\s]/g, "")
    .slice(0, 255);

  const extension = nombreSanitizado.split(".").pop()?.toLowerCase();

  // ─── Caché Inteligente de Validaciones (Supabase) ──────────────────────────
  try {
    const { data: cacheData, error: cacheError } = await supabase
      .from("validaciones")
      .select("resultado_ia")
      .eq("contenido_antiguo", contenido_antiguo)
      .eq("contenido_nuevo", contenido_nuevo)
      .limit(1)
      .maybeSingle();

    if (!cacheError && cacheData?.resultado_ia) {
      console.log(`[/api/validar] Caché HIT para archivo '${nombreSanitizado}'. Retornando resultado guardado.`);
      return NextResponse.json(cacheData.resultado_ia, {
        status: 200,
        headers: {
          "X-Cache": "HIT",
          "X-RateLimit-Remaining": String(remaining),
        },
      });
    }
  } catch (err) {
    console.warn("[/api/validar] Error al consultar la caché de validaciones:", err);
  }

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
        proveedor: "Analizador Local",
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
      let reporteError = "";
      const lineaError = xmlCheck.linea;

      if (xmlCheck.tipo === "sin_cerrar" && xmlCheck.tagMalo) {
        const tagSugerido = xmlCheck.tagMalo.endsWith("/") 
          ? xmlCheck.tagMalo 
          : `${xmlCheck.tagMalo} />`;

        reporteError = `### 🔴 Error Crítico de Sintaxis (Bloquea el Despliegue)
**Problema:** Falta el cierre de etiqueta \`/>\` o \`>\` en la **línea ${lineaError}** para la etiqueta \`${xmlCheck.tagMalo}\`.
**Impacto:** IIS no podrá parsear el archivo de configuración. La aplicación se caerá inmediatamente al desplegarse con un error \`HTTP Error 500.19 - Internal Server Error\`.
**Solución:** Corrige el cierre de la etiqueta en la **línea ${lineaError}** para que quede bien construida:
\`\`\`xml
${tagSugerido}
\`\`\``;
      } else if (xmlCheck.tipo === "abierto_final" && xmlCheck.nombreTag) {
        // Encontrar la línea donde se abrió originalmente ese tag
        let lineaApertura = 0;
        const indexApertura = contenido_nuevo.lastIndexOf(`<${xmlCheck.nombreTag}`);
        if (indexApertura !== -1) {
          lineaApertura = contenido_nuevo.substring(0, indexApertura).split("\n").length;
        }

        const ubicacionStr = lineaApertura > 0 
          ? `en la **línea ${lineaApertura}**` 
          : "dentro del archivo";

        reporteError = `### 🔴 Error Crítico de Sintaxis (Bloquea el Despliegue)
**Problema:** La etiqueta \`<${xmlCheck.nombreTag}>\` abierta ${ubicacionStr} no tiene una etiqueta de cierre correspondientes (\`</${xmlCheck.nombreTag}>\`) antes del final del documento.
**Impacto:** Error de configuración crítico. El servidor web rechazará el archivo como mal formado.
**Solución:** Agrega la etiqueta de cierre \`</${xmlCheck.nombreTag}>\` al final o en la línea de cierre correspondiente del archivo.`;
      } else if (xmlCheck.tipo === "cruzado" && xmlCheck.nombreTag) {
        reporteError = `### 🔴 Error Crítico de Sintaxis (Bloquea el Despliegue)
**Problema:** Error en la **línea ${lineaError}**. Se encontró la etiqueta de cierre \`</${xmlCheck.nombreTag}>\` pero no coincide con la última etiqueta abierta.
**Impacto:** Cruce de etiquetas inválido. Rompe el parser XML e impide la inicialización de la aplicación.
**Solución:** Corrige el orden de cierre de las etiquetas en la **línea ${lineaError}** para asegurar el balance correcto.`;
      } else {
        const lineaStr = lineaError ? ` en la **línea ${lineaError}**` : "";
        reporteError = `### 🔴 Error Crítico de Sintaxis (Bloquea el Despliegue)
**Problema:** XML mal formado${lineaStr}.
**Detalle:** ${xmlCheck.error || "Formato XML inválido"}
**Impacto:** Fallo inmediato en la inicialización de IIS o el servidor web.
**Solución:** Verifica que todas las etiquetas XML estén balanceadas y bien cerradas.`;
      }

      return NextResponse.json({
        valido: false,
        errores: [reporteError],
        advertencias: [],
        resumen: "El archivo nuevo tiene un error de sintaxis XML crítico y no se puede desplegar.",
        proveedor: "Analizador Local",
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

  // 7. Guardar en Supabase (bypasea RLS para inserción server-side)
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
