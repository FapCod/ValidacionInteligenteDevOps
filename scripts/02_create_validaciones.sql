-- ============================================================
-- 02_create_validaciones.sql
-- Ejecutar DESPUÉS de 01_create_usuarios.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.validaciones (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID        NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  nombre_archivo    TEXT        NOT NULL,
  contenido_antiguo TEXT        NOT NULL,
  contenido_nuevo   TEXT        NOT NULL,
  resultado_ia      JSONB       NOT NULL DEFAULT '{}',
  es_valido         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_validaciones_usuario_id  ON public.validaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_validaciones_created_at  ON public.validaciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validaciones_es_valido   ON public.validaciones(es_valido);
-- Índice GIN para búsquedas dentro del JSON de resultado_ia
CREATE INDEX IF NOT EXISTS idx_validaciones_resultado_ia ON public.validaciones USING GIN(resultado_ia);

-- Habilitar Row Level Security
ALTER TABLE public.validaciones ENABLE ROW LEVEL SECURITY;

-- Política: un usuario SOLO puede ver sus propias validaciones
-- Nadie puede ver los registros de otro usuario, ni siquiera por URL/API
CREATE POLICY "validaciones_solo_propias_select"
  ON public.validaciones FOR SELECT
  USING (usuario_id = auth.uid());

-- Política: un usuario solo puede insertar sus propias validaciones
-- El usuario_id del registro DEBE coincidir con el usuario autenticado
CREATE POLICY "validaciones_solo_propias_insert"
  ON public.validaciones FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

-- Política: no se permite UPDATE desde el cliente (solo desde server con service_role)
-- Esto previene que alguien altere resultados de validaciones pasadas
CREATE POLICY "validaciones_no_update_cliente"
  ON public.validaciones FOR UPDATE
  USING (FALSE);

-- Política: no se permite DELETE desde el cliente
CREATE POLICY "validaciones_no_delete_cliente"
  ON public.validaciones FOR DELETE
  USING (FALSE);

-- Comentarios descriptivos
COMMENT ON TABLE public.validaciones IS
  'Historial de todas las validaciones de archivos de configuración realizadas por IA';
COMMENT ON COLUMN public.validaciones.resultado_ia IS
  'Respuesta JSON de Gemini: { valido, errores, advertencias, resumen }';
COMMENT ON COLUMN public.validaciones.contenido_antiguo IS
  'Contenido del archivo en producción (versión base)';
COMMENT ON COLUMN public.validaciones.contenido_nuevo IS
  'Contenido del archivo a desplegar (versión candidata)';
