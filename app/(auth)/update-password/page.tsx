"use client";
// app/(auth)/update-password/page.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    setLoading(true);

    try {
      const { error } = await supabaseBrowser.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      setSuccessMsg("¡Contraseña restablecida con éxito! Redirigiendo al inicio de sesión...");
      
      // Cerrar la sesión temporal por seguridad
      await supabaseBrowser.auth.signOut();

      setTimeout(() => {
        router.push("/login");
      }, 3000);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al actualizar la contraseña";
      if (message.includes("Password should be at least")) {
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
        <h1 className="auth-title">Restablecer contraseña</h1>
        <p className="auth-subtitle">Ingresa tu nueva contraseña para acceder a tu cuenta</p>

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
          <div className="form-group">
            <label className="form-label" htmlFor="new-password">
              Nueva contraseña
            </label>
            <div style={{ position: "relative", width: "100%" }}>
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                className="form-input"
                style={{ paddingRight: "45px", width: "100%" }}
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  fontSize: "1.1rem",
                  cursor: "pointer",
                  color: "var(--color-text-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "4px"
                }}
                title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading}
            id="btn-update-password"
            style={{ width: "100%" }}
          >
            {loading ? (
              <>
                <span className="spinner" />
                Actualizando...
              </>
            ) : (
              "Restablecer contraseña"
            )}
          </button>
        </form>

        {/* Footer link */}
        <div className="auth-footer">
          <Link href="/login">Volver al inicio de sesión</Link>
        </div>
      </div>
    </div>
  );
}
