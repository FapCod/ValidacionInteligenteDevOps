// app/api/admin/prompt/route.ts
// Endpoint GET / POST para la administración del prompt del sistema de la IA.
// Protegido: Solo accesible por administradores.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";
import { SYSTEM_PROMPT } from "@/lib/gemini";

// Helper para validación de privilegios de administrador
async function verificarAdmin(request: NextRequest) {
  let user: { id: string; email: string };
  try {
    user = await requireAuth(request);
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }
    throw new AuthError("Error de autenticación", 401);
  }

  const supabase = createSupabaseServerClient();
  const { data: usuarioData, error: usuarioError } = await supabase
    .from("usuarios")
    .select("es_admin")
    .eq("id", user.id)
    .single();

  if (usuarioError || !usuarioData?.es_admin) {
    throw new AuthError("Acceso denegado: Se requieren permisos de administrador.", 403);
  }

  return { user, supabase };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await verificarAdmin(request);

    // Si se solicita el predeterminado por código
    const { searchParams } = new URL(request.url);
    const obtenerDefault = searchParams.get("default") === "true";

    if (obtenerDefault) {
      return NextResponse.json({ prompt: SYSTEM_PROMPT });
    }

    // Consultar el prompt activo desde la base de datos
    const { data, error } = await supabase
      .from("configuraciones")
      .select("valor")
      .eq("clave", "system_prompt")
      .single();

    if (error || !data) {
      // Si aún no está creado en la base de datos, retornar el predeterminado
      return NextResponse.json({ prompt: SYSTEM_PROMPT, isDefault: true });
    }

    return NextResponse.json({ prompt: data.valor, isDefault: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await verificarAdmin(request);

    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "El campo 'prompt' es requerido y debe ser texto." },
        { status: 400 }
      );
    }

    // Guardar o actualizar en la base de datos
    const { error } = await supabase
      .from("configuraciones")
      .upsert({
        clave: "system_prompt",
        valor: prompt,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error("[/api/admin/prompt] Error al hacer upsert:", error.message);
      return NextResponse.json(
        { error: "Error al guardar el prompt de sistema en la base de datos." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "Prompt guardado correctamente." });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
