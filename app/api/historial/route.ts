// app/api/historial/route.ts
// Endpoint GET /api/historial
// Retorna las últimas 50 validaciones del usuario autenticado.
// RLS en Supabase garantiza que nunca se filtren datos de otros usuarios.

// Fuerza modo dinámico: no se pre-renderiza en build time
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  // 1. Verificar JWT
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

  // 2. Consultar base de datos
  const supabase = createSupabaseServerClient();

  // 2a. Verificar si el usuario es administrador
  const { data: usuarioData, error: usuarioError } = await supabase
    .from("usuarios")
    .select("es_admin")
    .eq("id", user.id)
    .single();

  const esAdmin = !usuarioError && usuarioData?.es_admin === true;

  // 2b. Construir la consulta. Si es admin, traemos todas las validaciones e
  // incluimos los datos del usuario que la realizó (JOIN).
  let query = supabase
    .from("validaciones")
    .select(`
      id,
      nombre_archivo,
      resultado_ia,
      es_valido,
      created_at,
      usuario:usuarios (
        nombre,
        email
      )
    `);

  const { searchParams } = new URL(request.url);
  const targetUsuarioId = searchParams.get("usuario_id");

  if (esAdmin && targetUsuarioId) {
    // Si es admin y se especifica un usuario objetivo, filtramos por él
    query = query.eq("usuario_id", targetUsuarioId);
  } else {
    // Si no es admin, o si es admin consultando su propio historial, filtramos por su ID
    query = query.eq("usuario_id", user.id);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[/api/historial] Error consultando BD:", error.message);
    return NextResponse.json(
      { error: "Error al obtener el historial" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    validaciones: data ?? [],
    esAdmin
  });
}

// Solo se acepta GET
export async function POST() {
  return NextResponse.json({ error: "Método no permitido" }, { status: 405 });
}
