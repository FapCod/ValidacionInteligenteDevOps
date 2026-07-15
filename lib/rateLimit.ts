// lib/rateLimit.ts
// Rate limiting en memoria — máximo 10 validaciones por minuto por usuario
// No requiere Redis; adecuado para Render free tier con una sola instancia.

interface RateLimitEntry {
  count: number;
  resetAt: number; // timestamp en ms
}

const store = new Map<string, RateLimitEntry>();

const MAX_REQUESTS = 10;
const WINDOW_MS = 60 * 1000; // 1 minuto

/**
 * Verifica si el usuario puede hacer una nueva validación.
 * @param userId - ID del usuario autenticado (extraído del JWT, nunca del body)
 * @returns { allowed: boolean, remaining: number, resetInSeconds: number }
 */
export function checkRateLimit(userId: string): {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
} {
  const now = Date.now();
  const entry = store.get(userId);

  if (!entry || now > entry.resetAt) {
    // Nueva ventana
    store.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetInSeconds: 60 };
  }

  if (entry.count >= MAX_REQUESTS) {
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetInSeconds };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: MAX_REQUESTS - entry.count,
    resetInSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

// Limpieza periódica para evitar memory leaks en entradas expiradas
setInterval(() => {
  const now = Date.now();
  Array.from(store.entries()).forEach(([key, entry]) => {
    if (now > entry.resetAt) store.delete(key);
  });
}, WINDOW_MS);
