-- ============================================================
-- 04_create_reporte_consumo.sql
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- Crear una vista para obtener estadísticas agrupadas de consumo por usuario.
-- Calculamos los tokens estimados directamente en base a la longitud de los caracteres (aproximación estándar: 4 caracteres por token).
CREATE OR REPLACE VIEW public.reporte_consumo_usuarios AS
SELECT 
  u.id AS usuario_id,
  u.nombre,
  u.email,
  COUNT(v.id) AS total_consultas,
  COALESCE(SUM(ROUND((LENGTH(v.contenido_antiguo) + LENGTH(v.contenido_nuevo)) / 4.0)), 0)::BIGINT AS tokens_estimados
FROM 
  public.usuarios u
LEFT JOIN 
  public.validaciones v ON u.id = v.usuario_id
GROUP BY 
  u.id, u.nombre, u.email;

-- Asegurar que la vista sea accesible
GRANT SELECT ON public.reporte_consumo_usuarios TO authenticated;
GRANT SELECT ON public.reporte_consumo_usuarios TO service_role;
