// lib/auth.ts
// Validación de JWT de Supabase en el servidor
// El usuario_id SIEMPRE se extrae del token verificado, nunca del body del request.

import { createSupabaseServerClient } from "@/lib/supabase";
import type { NextRequest } from "next/server";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/**
 * Verifica el JWT del header Authorization y retorna el usuario.
 * Si el token es inválido, expirado o falta → lanza un error.
 * NUNCA confía en datos del body del request para identificar al usuario.
 */
export async function requireAuth(
  request: NextRequest
): Promise<AuthenticatedUser> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Token de autenticación no proporcionado", 401);
  }

  const token = authHeader.substring(7); // Eliminar "Bearer "

  // Verificar el token con Supabase (llama a la API de Supabase para validar)
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new AuthError("Sesión inválida o expirada. Vuelve a iniciar sesión.", 401);
  }

  return {
    id: data.user.id,
    email: data.user.email ?? "",
  };
}

export class AuthError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}
