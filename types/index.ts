// types/index.ts
// Tipos compartidos entre frontend y backend

export interface ValidationResult {
  valido: boolean;
  errores: string[];
  advertencias: string[];
  resumen: string;
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
