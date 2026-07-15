-- ============================================================
-- 01_create_usuarios.sql
-- Ejecutar primero en el SQL Editor de Supabase
-- ============================================================

-- La tabla de usuarios extiende auth.users de Supabase Auth
CREATE TABLE IF NOT EXISTS public.usuarios (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      TEXT        NOT NULL,
  email       TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice en email para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON public.usuarios(email);

-- Habilitar Row Level Security
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

-- Política: cada usuario solo puede ver y editar su propio registro
CREATE POLICY "usuarios_ver_propio"
  ON public.usuarios FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "usuarios_editar_propio"
  ON public.usuarios FOR UPDATE
  USING (id = auth.uid());

-- Función trigger: al registrarse en Supabase Auth, crea automáticamente
-- el registro en public.usuarios
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usuarios (id, nombre, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$;

-- Trigger: se dispara cuando Supabase Auth crea un nuevo usuario
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
