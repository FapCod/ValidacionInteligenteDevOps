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

  // 2. Consultar solo las validaciones del usuario autenticado
  // Aunque usemos service_role, filtramos explícitamente por usuario_id
  // como defensa en profundidad (no confiamos solo en RLS)
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("validaciones")
    .select(
      "id, nombre_archivo, resultado_ia, es_valido, created_at"
      // Excluimos contenido_antiguo y contenido_nuevo del listado (pueden ser grandes)
      // Se pueden obtener en un endpoint de detalle si se necesitan
    )
    .eq("usuario_id", user.id) // Filtro explícito por usuario
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[/api/historial] Error consultando BD:", error.message);
    return NextResponse.json(
      { error: "Error al obtener el historial" },
      { status: 500 }
    );
  }

  return NextResponse.json({ validaciones: data ?? [] });
}

// Solo se acepta GET
export async function POST() {
  return NextResponse.json({ error: "Método no permitido" }, { status: 405 });
}
