"use client";
// app/(dashboard)/admin/page.tsx

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import HistorialTable from "@/components/HistorialTable";
import type { ReporteConsumoUsuario, Validacion } from "@/types";

export default function AdminPage() {
  const [reporte, setReporte] = useState<ReporteConsumoUsuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Estado para el usuario seleccionado y sus consultas
  const [selectedUsuario, setSelectedUsuario] = useState<ReporteConsumoUsuario | null>(null);
  const [validacionesUsuario, setValidacionesUsuario] = useState<Partial<Validacion>[]>([]);
  const [loadingValidaciones, setLoadingValidaciones] = useState(false);
  const [errorValidaciones, setErrorValidaciones] = useState("");

  // Estado de buscador y paginación
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    async function fetchReporte() {
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

        const response = await fetch("/api/admin/reporte", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!response.ok) {
          const data = await response.json();
          setError(data.error || "Error al cargar el reporte de administración.");
          return;
        }

        const data = await response.json();
        setReporte(data.reporte ?? []);
      } catch {
        setError("Error de conexión al obtener el reporte.");
      } finally {
        setLoading(false);
      }
    }

    fetchReporte();
  }, []);

  const handleVerConsultas = async (usuario: ReporteConsumoUsuario) => {
    setSelectedUsuario(usuario);
    setLoadingValidaciones(true);
    setErrorValidaciones("");
    setValidacionesUsuario([]);

    try {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();

      if (!session) {
        setErrorValidaciones("Sesión expirada.");
        return;
      }

      const response = await fetch(`/api/historial?usuario_id=${usuario.usuario_id}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setErrorValidaciones(data.error || "Error al obtener las consultas del usuario.");
        return;
      }

      const data = await response.json();
      setValidacionesUsuario(data.validaciones ?? []);
    } catch {
      setErrorValidaciones("Error de conexión al obtener el historial.");
    } finally {
      setLoadingValidaciones(false);
    }
  };

  // Cálculos para KPIs globales
  const totalUsuarios = reporte.length;
  const totalConsultas = reporte.reduce((sum, item) => sum + Number(item.total_consultas), 0);
  const totalTokens = reporte.reduce((sum, item) => sum + Number(item.tokens_estimados), 0);

  // Filtrar y paginar el reporte de usuarios
  const filteredReporte = reporte.filter(
    (usr) =>
      usr.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      usr.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalItems = filteredReporte.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredReporte.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Panel de Administración</h1>
        <p className="page-subtitle">
          Supervisión global de consumo de tokens, consultas por usuario y auditoría de archivos validados.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: "24px" }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      {!loading && !error && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "20px",
            marginBottom: "32px",
          }}
        >
          <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              👥 Usuarios Activos
            </span>
            <span style={{ fontSize: "2rem", fontWeight: 700, color: "var(--color-primary)" }}>
              {totalUsuarios}
            </span>
          </div>

          <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              ⚡ Consultas Totales
            </span>
            <span style={{ fontSize: "2rem", fontWeight: 700, color: "var(--color-text)" }}>
              {totalConsultas}
            </span>
          </div>

          <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              🪙 Tokens Estimados (IA)
            </span>
            <span style={{ fontSize: "2rem", fontWeight: 700, color: "#10b981" }}>
              {totalTokens.toLocaleString("es-PE")}
            </span>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "32px" }}>
        {/* Tabla de Usuarios y Consumo */}
        <div className="card" style={{ padding: "0", overflow: "hidden" }}>
          <div
            style={{
              padding: "18px 24px",
              borderBottom: "1px solid var(--color-border)",
              background: "rgba(255, 255, 255, 0.01)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>📊 Consumo por Usuario</h3>
            <input
              type="text"
              className="form-input"
              placeholder="Buscar por nombre o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                maxWidth: "300px",
                padding: "8px 14px",
                fontSize: "0.85rem",
                height: "auto",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
            />
          </div>

          {loading ? (
            <div style={{ padding: "32px", textAlign: "center" }}>
              <div className="spinner" style={{ margin: "0 auto 16px" }} />
              <p style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>Cargando reporte de consumo...</p>
            </div>
          ) : filteredReporte.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--color-text-muted)" }}>
              {reporte.length === 0 
                ? "No se encontraron usuarios registrados en la plataforma." 
                : "No se encontraron usuarios que coincidan con la búsqueda."}
            </div>
          ) : (
            <div className="history-table-wrapper" style={{ border: "none", borderRadius: "0", marginBottom: "0" }}>
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th style={{ textAlign: "center" }}>Consultas</th>
                    <th style={{ textAlign: "right" }}>Tokens Est.</th>
                    <th style={{ width: "120px", textAlign: "center" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {currentItems.map((usr) => (
                    <tr
                      key={usr.usuario_id}
                      style={{
                        background: selectedUsuario?.usuario_id === usr.usuario_id ? "rgba(100, 116, 139, 0.08)" : "transparent",
                      }}
                    >
                      <td>
                        <span style={{ fontWeight: 500 }}>{usr.nombre}</span>
                      </td>
                      <td>
                        <span style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>{usr.email}</span>
                      </td>
                      <td style={{ textAlign: "center", fontWeight: 600 }}>{usr.total_consultas}</td>
                      <td style={{ textAlign: "right", color: "#10b981", fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                        {Number(usr.tokens_estimados).toLocaleString("es-PE")}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          className={`btn btn-sm ${selectedUsuario?.usuario_id === usr.usuario_id ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => handleVerConsultas(usr)}
                          type="button"
                          style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                        >
                          👁️ Ver Consultas
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginador Premium */}
          {!loading && totalPages > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderTop: "1px solid var(--color-border)",
                background: "rgba(15, 22, 38, 0.5)",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "var(--color-text-subtle)" }}>
                Mostrando <strong>{indexOfFirstItem + 1}</strong> -{" "}
                <strong>{Math.min(indexOfLastItem, totalItems)}</strong> de{" "}
                <strong>{totalItems}</strong> usuarios
              </span>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => { if (currentPage > 1) setCurrentPage(currentPage - 1); }}
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
                  onClick={() => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); }}
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

        {/* Sección de Consultas de Usuario Seleccionado */}
        {selectedUsuario && (
          <div className="card" style={{ padding: "24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
                borderBottom: "1px solid var(--color-border)",
                paddingBottom: "12px",
              }}
            >
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>📂 Consultas de:</span>
                  <span style={{ color: "var(--color-primary)" }}>{selectedUsuario.nombre}</span>
                  <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontWeight: 400 }}>({selectedUsuario.email})</span>
                </h3>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedUsuario(null)}
                type="button"
              >
                Cerrar Detalle
              </button>
            </div>

            {errorValidaciones && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: "16px" }}>
                <span>⚠️</span>
                <span>{errorValidaciones}</span>
              </div>
            )}

            <HistorialTable validaciones={validacionesUsuario} loading={loadingValidaciones} />
          </div>
        )}
      </div>
    </div>
  );
}
