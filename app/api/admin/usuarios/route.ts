// app/api/admin/usuarios/route.ts
// Endpoint PATCH /api/admin/usuarios
// Permite modificar privilegios de usuarios (ej: activar/desactivar acceso a validar con IA).
// Protegido: Solo accesible por administradores.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function PATCH(request: NextRequest) {
  // 1. Verificar autenticación
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

  // 2. Conectar a Supabase
  const supabase = createSupabaseServerClient();

  // 3. Verificar si el usuario autenticado es administrador
  const { data: usuarioData, error: usuarioError } = await supabase
    .from("usuarios")
    .select("es_admin")
    .eq("id", user.id)
    .single();

  if (usuarioError || !usuarioData?.es_admin) {
    return NextResponse.json(
      { error: "Acceso denegado: Se requieren permisos de administrador." },
      { status: 403 }
    );
  }

  // 4. Procesar el cuerpo de la petición
  try {
    const body = await request.json();
    const { usuario_id, puede_validar_ia } = body;

    if (!usuario_id || typeof puede_validar_ia !== "boolean") {
      return NextResponse.json(
        { error: "Los campos 'usuario_id' (UUID) y 'puede_validar_ia' (booleano) son obligatorios." },
        { status: 400 }
      );
    }

    // Evitar que el administrador se bloquee a sí mismo del uso de IA por accidente
    if (usuario_id === user.id && !puede_validar_ia) {
      return NextResponse.json(
        { error: "No puedes desactivarte el acceso a la validación con IA a ti mismo." },
        { status: 400 }
      );
    }

    // 5. Actualizar los permisos en la base de datos
    const { error: updateError } = await supabase
      .from("usuarios")
      .update({ puede_validar_ia })
      .eq("id", usuario_id);

    if (updateError) {
      console.error("[/api/admin/usuarios] Error al actualizar privilegios:", updateError.message);
      return NextResponse.json(
        { error: "Error al actualizar los permisos del usuario." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "Permisos actualizados correctamente." });
  } catch (parseErr) {
    return NextResponse.json({ error: "Cuerpo de petición inválido o JSON mal formado." }, { status: 400 });
  }
}
