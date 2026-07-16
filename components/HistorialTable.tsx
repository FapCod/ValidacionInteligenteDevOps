"use client";

import { useState, useEffect } from "react";
import type { Validacion } from "@/types";

interface Props {
  validaciones: Partial<Validacion>[];
  loading?: boolean;
  esAdmin?: boolean;
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

export default function HistorialTable({ validaciones, loading, esAdmin = false }: Props) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  useEffect(() => {
    setCurrentPage(1);
  }, [validaciones]);

  if (loading) {
    return (
      <div className="history-table-wrapper">
        <table className="history-table">
          <thead>
            <tr>
              {esAdmin && <th>Usuario</th>}
              <th>Archivo</th>
              <th>Estado</th>
              <th>Errores</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: esAdmin ? 5 : 4 }).map((_, j) => (
                  <td key={j}>
                    <div
                      className="skeleton"
                      style={{ height: "16px", width: j === 0 && esAdmin ? "140px" : j === 1 && esAdmin ? "180px" : j === 0 ? "180px" : "80px" }}
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

  // Lógica de Paginación
  const totalItems = validaciones.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = validaciones.slice(indexOfFirstItem, indexOfLastItem);

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  return (
    <div className="history-table-wrapper">
      <table className="history-table">
        <thead>
          <tr>
            {esAdmin && <th>Usuario</th>}
            <th>Archivo</th>
            <th>Estado</th>
            <th>Errores / Advertencias</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {currentItems.map((v) => {
            const erroresCount = v.resultado_ia?.errores?.length ?? 0;
            const advertenciasCount = v.resultado_ia?.advertencias?.length ?? 0;

            return (
              <tr key={v.id}>
                {esAdmin && (
                  <td>
                    <span style={{ fontSize: "0.82rem", fontWeight: 500 }} title={v.usuario?.email}>
                      {v.usuario?.nombre || v.usuario?.email?.split("@")[0] || "—"}
                    </span>
                  </td>
                )}
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

      {/* Paginador Premium */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderTop: "1px solid var(--color-border)",
            background: "var(--color-bg-secondary)",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-subtle)" }}>
            Mostrando <strong>{indexOfFirstItem + 1}</strong> -{" "}
            <strong>{Math.min(indexOfLastItem, totalItems)}</strong> de{" "}
            <strong>{totalItems}</strong> registros
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              style={{
                opacity: currentPage === 1 ? 0.4 : 1,
                cursor: currentPage === 1 ? "not-allowed" : "pointer",
                padding: "6px 12px",
                fontSize: "0.75rem",
              }}
              type="button"
            >
              ◀ Anterior
            </button>

            <span
              style={{
                fontSize: "0.8rem",
                color: "var(--color-text-subtle)",
                padding: "0 8px",
              }}
            >
              Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
            </span>

            <button
              className="btn btn-sm btn-secondary"
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              style={{
                opacity: currentPage === totalPages ? 0.4 : 1,
                cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                padding: "6px 12px",
                fontSize: "0.75rem",
              }}
              type="button"
            >
              Siguiente ▶
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
