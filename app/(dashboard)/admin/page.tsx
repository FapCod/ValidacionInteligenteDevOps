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

  // Estado para el editor de prompt de sistema administrable
  const [activeTab, setActiveTab] = useState<"users" | "prompt">("users");
  const [promptValue, setPromptValue] = useState("");
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [successPrompt, setSuccessPrompt] = useState("");
  const [errorPrompt, setErrorPrompt] = useState("");

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

  // Efecto para cargar el prompt cuando se selecciona la pestaña
  useEffect(() => {
    if (activeTab === "prompt" && !promptValue) {
      fetchPrompt();
    }
  }, [activeTab]);

  const fetchPrompt = async (isDefault = false) => {
    setLoadingPrompt(true);
    setErrorPrompt("");
    setSuccessPrompt("");
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        setErrorPrompt("Sesión expirada. Vuelve a iniciar sesión.");
        return;
      }

      const response = await fetch(`/api/admin/prompt${isDefault ? "?default=true" : ""}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "Error al cargar el prompt");
      }

      setPromptValue(resData.prompt || "");
      if (isDefault) {
        setSuccessPrompt("Se cargó la plantilla del prompt predeterminado. (Recuerda presionar Guardar para aplicar en producción)");
      }
    } catch (err: any) {
      setErrorPrompt(err.message || "Error al obtener el prompt.");
    } finally {
      setLoadingPrompt(false);
    }
  };

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    setErrorPrompt("");
    setSuccessPrompt("");
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        setErrorPrompt("Sesión expirada. Vuelve a iniciar sesión.");
        return;
      }

      const response = await fetch("/api/admin/prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ prompt: promptValue }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "Error al guardar el prompt");
      }

      setSuccessPrompt("¡Prompt de sistema guardado y activado correctamente en producción!");
    } catch (err: any) {
      setErrorPrompt(err.message || "Error al guardar el prompt.");
    } finally {
      setSavingPrompt(false);
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

      {/* Barra de Navegación de Pestañas (Tabs) */}
      {!loading && !error && (
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom: "28px",
            borderBottom: "1px solid var(--color-border)",
            paddingBottom: "12px",
          }}
        >
          <button
            className={`btn ${activeTab === "users" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("users")}
            type="button"
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px", fontSize: "0.85rem" }}
          >
            📊 Reporte de Consumo
          </button>
          <button
            className={`btn ${activeTab === "prompt" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("prompt")}
            type="button"
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px", fontSize: "0.85rem" }}
          >
            ⚙️ Configurar Prompt de IA
          </button>
        </div>
      )}

      {activeTab === "users" ? (
        <>
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
                <span style={{ fontSize: "2rem", fontWeight: 700, color: "var(--color-primary)" }}>
                  {totalConsultas}
                </span>
              </div>

              <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  📊 Estimación de Tokens
                </span>
                <span style={{ fontSize: "1.8rem", fontWeight: 700, color: "#10b981" }}>
                  {totalTokens.toLocaleString("es-PE")}
                </span>
              </div>
            </div>
          )}

          {/* Tabla de Consumo por Usuario */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "32px" }}>
            <div className="card">
              <div
                style={{
                  padding: "20px",
                  borderBottom: "1px solid var(--color-border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "16px",
                }}
              >
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>📊 Consumo por Usuario</h3>
                  <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", margin: "4px 0 0 0" }}>
                    Resumen detallado de consultas de IA ejecutadas y consumo total acumulado.
                  </p>
                </div>

                {/* Buscador de Usuarios */}
                <div style={{ position: "relative", minWidth: "260px" }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="🔍 Buscar por nombre o correo..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1); // Restablecer a página 1 al buscar
                    }}
                    style={{
                      padding: "8px 12px 8px 36px",
                      fontSize: "0.85rem",
                      borderRadius: "var(--radius-md)",
                      width: "100%",
                    }}
                  />
                  <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-muted)" }} />
                </div>
              </div>

              {loading ? (
                <div style={{ padding: "48px", textAlign: "center" }}>
                  <div className="spinner" style={{ margin: "0 auto 16px" }} />
                  <p style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>Cargando datos de consumo...</p>
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
        </>
      ) : (
        /* Pestaña: Configurar Prompt */
        <div className="card" style={{ padding: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
              borderBottom: "1px solid var(--color-border)",
              paddingBottom: "16px",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>⚙️ Modificar Prompt de Sistema de la IA</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", margin: "4px 0 0 0" }}>
                Este prompt define las directrices DevOps, reglas SQL Server y la estructura JSON requerida para los análisis. ¡Modifica con precaución!
              </p>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (window.confirm("¿Seguro que deseas cargar la plantilla predeterminada de fábrica? Esto sobrescribirá el texto actual (deberás pulsar 'Guardar' para aplicarlo).")) {
                  fetchPrompt(true);
                }
              }}
              disabled={loadingPrompt || savingPrompt}
              type="button"
              style={{ fontSize: "0.75rem", padding: "6px 12px" }}
            >
              🔄 Plantilla Predeterminada
            </button>
          </div>

          {/* Tarjeta de Advertencia e Instrucción */}
          <div
            style={{
              background: "rgba(30, 41, 59, 0.4)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              padding: "16px 20px",
              marginBottom: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
              ⚠️ IMPORTANTE: Estructura JSON Obligatoria
            </span>
            <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", margin: 0, lineHeight: "1.5" }}>
              La IA debe retornar estrictamente un objeto JSON que contenga las siguientes propiedades. Si renombras o eliminas estas claves, la aplicación no podrá procesar ni almacenar los resultados de validación:
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "12px",
                marginTop: "4px",
                fontSize: "0.8rem",
              }}
            >
              <div style={{ background: "rgba(15, 22, 38, 0.4)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                <code style={{ color: "var(--color-primary)", fontWeight: 600 }}>"valido"</code>
                <div style={{ color: "var(--color-text-muted)", marginTop: "2px" }}>Booleano (<code style={{ color: "#34d399" }}>true</code> / <code style={{ color: "#f87171" }}>false</code>) obligatorio para el estado final.</div>
              </div>
              <div style={{ background: "rgba(15, 22, 38, 0.4)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                <code style={{ color: "var(--color-primary)", fontWeight: 600 }}>"errores_criticos"</code>
                <div style={{ color: "var(--color-text-muted)", marginTop: "2px" }}>Array de objetos con <code>tipo</code>, <code>descripcion</code> y <code>linea_aproximada</code>.</div>
              </div>
              <div style={{ background: "rgba(15, 22, 38, 0.4)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                <code style={{ color: "var(--color-primary)", fontWeight: 600 }}>"advertencias"</code>
                <div style={{ color: "var(--color-text-muted)", marginTop: "2px" }}>Array de objetos con <code>tipo</code> y <code>descripcion</code> para avisos no bloqueantes.</div>
              </div>
              <div style={{ background: "rgba(15, 22, 38, 0.4)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                <code style={{ color: "var(--color-primary)", fontWeight: 600 }}>"resumen"</code>
                <div style={{ color: "var(--color-text-muted)", marginTop: "2px" }}>Texto de resumen ejecutivo sobre el estado general del análisis.</div>
              </div>
            </div>
          </div>

          {errorPrompt && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: "20px" }}>
              <span>⚠️</span>
              <span>{errorPrompt}</span>
            </div>
          )}

          {successPrompt && (
            <div
              className="alert alert-success"
              role="alert"
              style={{
                marginBottom: "20px",
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                color: "#34d399",
                padding: "12px 16px",
                borderRadius: "var(--radius-md)",
                display: "flex",
                gap: "8px",
                alignItems: "center",
              }}
            >
              <span>✅</span>
              <span>{successPrompt}</span>
            </div>
          )}

          {loadingPrompt ? (
            <div style={{ padding: "48px", textAlign: "center" }}>
              <div className="spinner" style={{ margin: "0 auto 16px" }} />
              <p style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>Cargando prompt de sistema desde la base de datos...</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <textarea
                className="form-input"
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                style={{
                  minHeight: "520px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.85rem",
                  resize: "vertical",
                  width: "100%",
                  padding: "16px",
                  lineHeight: "1.6",
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-text)",
                }}
                placeholder="Escribe las directrices del sistema aquí..."
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => fetchPrompt(false)}
                  disabled={savingPrompt}
                  type="button"
                >
                  Cancelar / Revertir
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSavePrompt}
                  disabled={savingPrompt}
                  type="button"
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  {savingPrompt ? (
                    <>
                      <div className="spinner" style={{ width: "14px", height: "14px", borderWidth: "2px", margin: 0 }} />
                      Guardando...
                    </>
                  ) : (
                    <>💾 Guardar Prompt</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
