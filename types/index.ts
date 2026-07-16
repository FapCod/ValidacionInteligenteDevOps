// types/index.ts
// Tipos compartidos entre frontend y backend

// Re-export del tipo side-by-side desde lib/diff
export type { SideBySideRow } from "@/lib/diff";

export interface ValidationResult {
  valido: boolean;
  errores: string[];
  advertencias: string[];
  resumen: string;
  proveedor?: string; // IA o motor que procesó la validación
}

export interface Validacion {
  id: string;
  usuario_id: string;
  nombre_archivo: string;
  contenido_antiguo: string;
  contenido_nuevo: string;
  resultado_ia: ValidationResult;
  es_valido: boolean;
  created_at: string;
  usuario?: {
    nombre: string;
    email: string;
  };
}

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  created_at: string;
}

export interface DiffLine {
  type: "equal" | "added" | "removed";
  content: string;
  lineOld: number | null;
  lineNew: number | null;
}

export interface ValidarRequestBody {
  nombre_archivo: string;
  contenido_antiguo: string;
  contenido_nuevo: string;
}

export interface ApiError {
  error: string;
  code?: string;
}

export interface ReporteConsumoUsuario {
  usuario_id: string;
  nombre: string;
  email: string;
  puede_validar_ia: boolean;
  total_consultas: number;
  tokens_estimados: number;
}
