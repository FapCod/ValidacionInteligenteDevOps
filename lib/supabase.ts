// lib/supabase.ts
// Clientes de Supabase separados para server y browser

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Cliente para el BROWSER (usa anon key, protegido por RLS) ───────────────
// Seguro: la anon key está diseñada para ser pública.
// RLS garantiza que cada usuario solo acceda a sus propios datos.
// Lazy singleton: se inicializa solo cuando se necesita (no en build time).
let _browserClient: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (!_browserClient) {
    _browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _browserClient;
}

// Alias para compatibilidad — retorna el cliente real de Supabase
// (todos los métodos auth.*  funcionan directamente)
export const supabaseBrowser = {
  get auth() {
    return getBrowserClient().auth;
  },
};

// ─── Cliente para el SERVER (usa service_role key) ───────────────────────────
// NUNCA exportar ni usar en código cliente.
// La service_role key bypasea RLS — solo para operaciones internas del server.
export function createSupabaseServerClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no está definida. " +
        "Esta variable es solo para el servidor."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
