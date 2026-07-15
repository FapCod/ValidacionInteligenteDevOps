"use client";
// components/AuthForm.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

interface AuthFormProps {
  mode: "login" | "register";
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const isLogin = mode === "login";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabaseBrowser.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push("/validar");
        router.refresh();
      } else {
        const { error } = await supabaseBrowser.auth.signUp({
          email,
          password,
          options: {
            data: { nombre },
          },
        });
        if (error) throw error;
        setSuccessMsg(
          "¡Cuenta creada! Revisa tu email para confirmar tu cuenta, luego inicia sesión."
        );
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Error desconocido";

      // Mensajes de error en español
      if (message.includes("Invalid login credentials")) {
        setError("Email o contraseña incorrectos");
      } else if (message.includes("User already registered")) {
        setError("Este email ya está registrado. Inicia sesión.");
      } else if (message.includes("Password should be at least")) {
        setError("La contraseña debe tener al menos 6 caracteres");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Header */}
        <div className="auth-logo">
          <div className="logo-icon">⚡</div>
          <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>ValidaDoc</span>
        </div>
        <h1 className="auth-title">
          {isLogin ? "Bienvenido de vuelta" : "Crear cuenta"}
        </h1>
        <p className="auth-subtitle">
          {isLogin
            ? "Ingresa tus credenciales para continuar"
            : "Empieza a validar tus configuraciones con IA"}
        </p>

        {/* Alerts */}
        {error && (
          <div className="alert alert-error" role="alert">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="alert alert-success" role="status">
            <span>✅</span>
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {!isLogin && (
            <div className="form-group">
              <label className="form-label" htmlFor="nombre">
                Nombre
              </label>
              <input
                id="nombre"
                type="text"
                className="form-input"
                placeholder="Tu nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required={!isLogin}
                autoComplete="name"
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="tu@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              className="form-input"
              placeholder={isLogin ? "••••••••" : "Mínimo 6 caracteres"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={isLogin ? "current-password" : "new-password"}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading}
            id={isLogin ? "btn-login" : "btn-register"}
          >
            {loading ? (
              <>
                <span className="spinner" />
                {isLogin ? "Ingresando..." : "Creando cuenta..."}
              </>
            ) : isLogin ? (
              "Iniciar sesión"
            ) : (
              "Crear cuenta"
            )}
          </button>
        </form>

        {/* Footer link */}
        <div className="auth-footer">
          {isLogin ? (
            <>
              ¿No tienes cuenta?{" "}
              <Link href="/register">Regístrate gratis</Link>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <Link href="/login">Inicia sesión</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
