// app/api/admin/reporte/route.ts
// Endpoint GET /api/admin/reporte
// Retorna estadísticas de consumo (consultas y tokens estimados) agrupadas por usuario.
// Protegido: Solo accesible por administradores.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  // 1. Verificar JWT del usuario
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

  // 3. Verificar si es administrador
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

  // 4. Consultar la vista de reporte de consumo
  const { data, error } = await supabase
    .from("reporte_consumo_usuarios")
    .select("*")
    .order("total_consultas", { ascending: false });

  if (error) {
    console.error("[/api/admin/reporte] Error consultando vista:", error.message);
    return NextResponse.json(
      { error: "Error al obtener el reporte de consumo" },
      { status: 500 }
    );
  }

  return NextResponse.json({ reporte: data ?? [] });
}

// Métodos no permitidos
export async function POST() {
  return NextResponse.json({ error: "Método no permitido" }, { status: 405 });
}
