"use client";
// components/HistorialTable.tsx

import type { Validacion } from "@/types";

interface Props {
  validaciones: Partial<Validacion>[];
  loading?: boolean;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function HistorialTable({ validaciones, loading }: Props) {
  if (loading) {
    return (
      <div className="history-table-wrapper">
        <table className="history-table">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Estado</th>
              <th>Errores</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 4 }).map((_, j) => (
                  <td key={j}>
                    <div
                      className="skeleton"
                      style={{ height: "16px", width: j === 0 ? "180px" : "80px" }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!validaciones || validaciones.length === 0) {
    return (
      <div className="history-table-wrapper">
        <div className="empty-state">
          <div className="empty-icon">📂</div>
          <p>No hay validaciones registradas aún.</p>
          <p style={{ marginTop: "8px", fontSize: "0.85rem", opacity: 0.6 }}>
            Ve al <strong>Validador</strong> y sube tus primeros archivos para comenzar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-table-wrapper">
      <table className="history-table">
        <thead>
          <tr>
            <th>Archivo</th>
            <th>Estado</th>
            <th>Errores / Advertencias</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {validaciones.map((v) => {
            const erroresCount = v.resultado_ia?.errores?.length ?? 0;
            const advertenciasCount = v.resultado_ia?.advertencias?.length ?? 0;

            return (
              <tr key={v.id}>
                <td>
                  <span className="file-name-cell">
                    {v.nombre_archivo ?? "—"}
                  </span>
                </td>
                <td>
                  <span
                    className={`status-badge ${v.es_valido ? "valid" : "invalid"}`}
                  >
                    {v.es_valido ? "✅ Válido" : "❌ Inválido"}
                  </span>
                </td>
                <td>
                  <span style={{ color: erroresCount > 0 ? "#ef4444" : "#64748b" }}>
                    {erroresCount > 0
                      ? `${erroresCount} error${erroresCount > 1 ? "es" : ""}`
                      : "Sin errores"}
                  </span>
                  {advertenciasCount > 0 && (
                    <span
                      style={{
                        marginLeft: "8px",
                        color: "#f59e0b",
                        fontSize: "0.8rem",
                      }}
                    >
                      · {advertenciasCount} advertencia{advertenciasCount > 1 ? "s" : ""}
                    </span>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}>
                  {v.created_at ? formatDate(v.created_at) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
