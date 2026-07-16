-- ============================================================
-- 03_add_es_admin.sql
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- 1. Agregar columna es_admin a la tabla usuarios
ALTER TABLE public.usuarios 
ADD COLUMN IF NOT EXISTS es_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Actualizar política RLS para lectura (SELECT) en validaciones
-- Eliminamos la política anterior que limitaba solo a propias
DROP POLICY IF EXISTS "validaciones_solo_propias_select" ON public.validaciones;

-- Creamos una nueva política que permite ver si es propio OR si el usuario es admin
CREATE POLICY "validaciones_select_policy"
  ON public.validaciones FOR SELECT
  USING (
    usuario_id = auth.uid() OR 
    (SELECT es_admin FROM public.usuarios WHERE id = auth.uid()) = TRUE
  );

-- Comentario descriptivo para la columna
COMMENT ON COLUMN public.usuarios.es_admin IS 'Indica si el usuario tiene privilegios de administrador para ver todo el historial';
