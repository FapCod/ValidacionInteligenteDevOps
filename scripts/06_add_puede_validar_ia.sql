-- ============================================================
-- 06_add_puede_validar_ia.sql
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- 1. Agregar la columna puede_validar_ia a la tabla de usuarios
ALTER TABLE public.usuarios 
ADD COLUMN IF NOT EXISTS puede_validar_ia BOOLEAN NOT NULL DEFAULT TRUE;

-- Comentario descriptivo para la columna
COMMENT ON COLUMN public.usuarios.puede_validar_ia IS 'Indica si el usuario tiene permitido usar la funcionalidad de validar con IA';

-- 1.5 Eliminar la vista existente para poder alterar la estructura de columnas
DROP VIEW IF EXISTS public.reporte_consumo_usuarios CASCADE;

-- 2. Recrear la vista reporte_consumo_usuarios incluyendo puede_validar_ia
CREATE VIEW public.reporte_consumo_usuarios AS
SELECT 
  u.id AS usuario_id,
  u.nombre,
  u.email,
  u.puede_validar_ia,
  COUNT(v.id) AS total_consultas,
  COALESCE(SUM(ROUND((LENGTH(v.contenido_antiguo) + LENGTH(v.contenido_nuevo)) / 4.0)), 0)::BIGINT AS tokens_estimados
FROM 
  public.usuarios u
LEFT JOIN 
  public.validaciones v ON u.id = v.usuario_id
GROUP BY 
  u.id, u.nombre, u.email, u.puede_validar_ia;

-- Otorgar permisos sobre la vista recreada
GRANT SELECT ON public.reporte_consumo_usuarios TO authenticated;
GRANT SELECT ON public.reporte_consumo_usuarios TO service_role;
