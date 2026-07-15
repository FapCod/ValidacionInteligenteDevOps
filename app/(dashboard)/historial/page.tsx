"use client";
// app/(dashboard)/historial/page.tsx

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import HistorialTable from "@/components/HistorialTable";
import type { Validacion } from "@/types";

export default function HistorialPage() {
  const [validaciones, setValidaciones] = useState<Partial<Validacion>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchHistorial() {
      setLoading(true);
      setError("");

      try {
        const {
          data: { session },
        } = await supabaseBrowser.auth.getSession();

        if (!session) {
          setError("Sesión expirada. Vuelve a iniciar sesión.");
          return;
        }

        const response = await fetch("/api/historial", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!response.ok) {
          const data = await response.json();
          setError(data.error || "Error al cargar el historial");
          return;
        }

        const data = await response.json();
        setValidaciones(data.validaciones ?? []);
      } catch {
        setError("Error de conexión. Intenta de nuevo.");
      } finally {
        setLoading(false);
      }
    }

    fetchHistorial();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Historial de Validaciones</h1>
        <p className="page-subtitle">
          Registro de todas tus validaciones de archivos de configuración.
          Solo puedes ver tus propios registros.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div style={{ marginBottom: "16px", display: "flex", justifyContent: "flex-end" }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setLoading(true);
            setValidaciones([]);
            // Re-trigger effect
            setTimeout(() => window.location.reload(), 100);
          }}
        >
          🔄 Actualizar
        </button>
      </div>

      <HistorialTable validaciones={validaciones} loading={loading} />

      {!loading && validaciones.length > 0 && (
        <p
          style={{
            textAlign: "center",
            marginTop: "16px",
            fontSize: "0.8rem",
            color: "var(--color-text-muted)",
          }}
        >
          Mostrando los últimos {validaciones.length} registros
        </p>
      )}
    </div>
  );
}
