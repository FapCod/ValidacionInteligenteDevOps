"use client";
// components/FileComparator.tsx
// Componente principal: carga de archivos, drag & drop, diff visual y llamada a IA

import { useState, useCallback, useRef, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { computeSideBySideDiff } from "@/lib/diff";
import { detectFileType, type DetectedType } from "@/lib/detectFileType";
import ValidationResultPanel from "@/components/ValidationResult";
import type { SideBySideRow, ValidationResult } from "@/types";
import { diffChars } from "diff";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// Helper para visualizar y resaltar espacios en blanco al final de la línea
function highlightWhitespaces(text: string) {
  if (!text) return "";

  const trailingSpaceRegex = /(\s+)$/;
  const match = text.match(trailingSpaceRegex);

  if (match) {
    const trailingSpaces = match[1];
    const mainText = text.slice(0, -trailingSpaces.length);
    const spaceVisual = "·".repeat(trailingSpaces.length);

    return (
      <>
        {mainText}
        <span 
          className="highlight-space" 
          title={`${trailingSpaces.length} espacio(s) en blanco al final`}
        >
          {spaceVisual}
        </span>
      </>
    );
  }

  return text;
}

// Helper para visualizar y resaltar cambios de caracteres específicos en una línea modificada
function renderInlineDiff(oldText: string, newText: string, isRightSide: boolean) {
  const diffs = diffChars(oldText, newText);

  return (
    <>
      {diffs.map((part, index) => {
        if (isRightSide) {
          // Lado derecho (Nuevos cambios - added)
          if (part.added) {
            const isWhitespace = /^\s+$/.test(part.value);
            return (
              <span 
                key={index} 
                className="inline-added"
                title={isWhitespace ? `${part.value.length} espacio(s) agregado(s)` : undefined}
              >
                {isWhitespace ? "·".repeat(part.value.length) : part.value}
              </span>
            );
          }
          if (part.removed) {
            return null; // Omitir eliminados
          }
          return part.value; // Texto sin cambios
        } else {
          // Lado izquierdo (Antiguos cambios - removed)
          if (part.removed) {
            const isWhitespace = /^\s+$/.test(part.value);
            return (
              <span 
                key={index} 
                className="inline-removed"
                title={isWhitespace ? `${part.value.length} espacio(s) eliminado(s)` : undefined}
              >
                {isWhitespace ? "·".repeat(part.value.length) : part.value}
              </span>
            );
          }
          if (part.added) {
            return null; // Omitir agregados
          }
          return part.value; // Texto sin cambios
        }
      })}
    </>
  );
}

// ─── Diff Side-by-Side Viewer ─────────────────────────────────────────────────
function DiffViewer({ rows }: { rows: SideBySideRow[] }) {
  const [soloCambios, setSoloCambios] = useState(false);

  const addedCount   = rows.filter((r) => r.right.type === "added").length;
  const removedCount = rows.filter((r) => r.left.type  === "removed").length;

  const signFor = (type: string) =>
    type === "added" ? "+" : type === "removed" ? "−" : " ";

  const isIdentical = addedCount === 0 && removedCount === 0;

  // Encontrar índices de las filas que contienen cambios reales
  const changedIndices = rows
    .map((row, index) => ({ row, index }))
    .filter(item => item.row.left.type !== "equal" || item.row.right.type !== "equal")
    .map(item => item.index);

  // Calcular filas visibles aplicando el filtro de colapso de líneas idénticas
  const getVisibleRows = () => {
    if (!soloCambios) {
      return rows.map((row, index) => ({ type: "row" as const, row, index }));
    }

    const items: ({ type: "row"; row: SideBySideRow; index: number } | { type: "separator"; count: number })[] = [];
    let hiddenCount = 0;

    for (let i = 0; i < rows.length; i++) {
      // Determinar si la fila actual o alguna cercana (dentro de un radio de 3 filas) tiene cambios
      let nearChange = false;
      for (let j = Math.max(0, i - 3); j <= Math.min(rows.length - 1, i + 3); j++) {
        if (rows[j].left.type !== "equal" || rows[j].right.type !== "equal") {
          nearChange = true;
          break;
        }
      }

      if (nearChange) {
        if (hiddenCount > 0) {
          items.push({ type: "separator", count: hiddenCount });
          hiddenCount = 0;
        }
        items.push({ type: "row", row: rows[i], index: i });
      } else {
        hiddenCount++;
      }
    }

    if (hiddenCount > 0) {
      items.push({ type: "separator", count: hiddenCount });
    }

    return items;
  };

  const visibleItems = getVisibleRows();

  return (
    <div className="diff-viewer">
      <div className="diff-header" style={{ flexWrap: "wrap", gap: "14px" }}>
        <span className="diff-title">📊 Diff Side-by-Side</span>
        
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          {/* Checkbox para ocultar líneas idénticas */}
          {!isIdentical && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", cursor: "pointer", userSelect: "none", color: "var(--color-text)" }}>
              <input 
                type="checkbox" 
                checked={soloCambios} 
                onChange={(e) => setSoloCambios(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <span>🔍 Solo mostrar cambios</span>
            </label>
          )}

          {/* Buscador/Atajos rápidos a líneas con cambios */}
          {changedIndices.length > 0 && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
              <span>📍 Líneas:</span>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {changedIndices.slice(0, 10).map((idx) => {
                  const leftLine = rows[idx].left.lineNum;
                  const rightLine = rows[idx].right.lineNum;
                  const label = leftLine || rightLine || `${idx + 1}`;
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        const el = document.getElementById(`diff-row-${idx}`);
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                          // Destello temporal para enfocar la vista del usuario
                          el.style.outline = "2px solid var(--color-primary)";
                          setTimeout(() => { el.style.outline = "none"; }, 1500);
                        }
                      }}
                      style={{
                        background: "var(--color-bg-secondary)",
                        border: "1px solid var(--color-border-light)",
                        borderRadius: "4px",
                        padding: "2px 6px",
                        color: "var(--color-primary)",
                        fontWeight: 600,
                        fontSize: "0.72rem",
                        cursor: "pointer",
                      }}
                      type="button"
                    >
                      #{label}
                    </button>
                  );
                })}
                {changedIndices.length > 10 && <span style={{ fontSize: "0.75rem" }}>...</span>}
              </div>
            </div>
          )}

          <div className="diff-stats">
            <span className="added">+{addedCount} líneas agregadas</span>
            <span className="removed">−{removedCount} líneas eliminadas</span>
          </div>
        </div>
      </div>

      {isIdentical ? (
        <div
          style={{
            padding: "48px 32px",
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.9rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "2rem" }}>✨</span>
          <span style={{ fontWeight: 600, color: "var(--color-text-subtle)" }}>
            Los archivos son idénticos
          </span>
          <span style={{ fontSize: "0.8rem", opacity: 0.8 }}>
            No se han encontrado diferencias ni cambios de código.
          </span>
        </div>
      ) : (
        <>
          <div className="diff-col-headers">
            <div className="diff-col-header old">🔴 Versión Anterior (Producción)</div>
            <div className="diff-col-header new">🟢 Versión Nueva (A desplegar)</div>
          </div>
          <div style={{ position: "relative" }}>
            <div className="diff-sbs-scroll" aria-label="Diff side-by-side">
              {visibleItems.map((item, i) => {
                if (item.type === "separator") {
                  return (
                    <div 
                      key={`sep-${i}`} 
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "8px 0",
                        background: "var(--color-bg-secondary)",
                        color: "var(--color-text-subtle)",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        fontFamily: "var(--font-sans)",
                        borderTop: "1px dashed var(--color-border-light)",
                        borderBottom: "1px dashed var(--color-border-light)",
                        userSelect: "none",
                        gap: "6px"
                      }}
                    >
                      <span>↕️</span>
                      <span>{item.count} líneas idénticas ocultas</span>
                    </div>
                  );
                }

                const { row, index } = item;
                const isPaired = row.left.type === "removed" && row.right.type === "added";

                return (
                  <div key={index} id={`diff-row-${index}`} className="diff-sbs-row" style={{ transition: "outline 0.3s ease" }}>
                    <div className={`diff-sbs-cell ${row.left.type}`}>
                      <div className="sbs-num">{row.left.lineNum ?? ""}</div>
                      <div className="sbs-sign">
                        {row.left.type === "empty" ? "" : signFor(row.left.type)}
                      </div>
                      <div className="sbs-content">
                        {isPaired 
                          ? renderInlineDiff(row.left.content, row.right.content, false)
                          : highlightWhitespaces(row.left.content)}
                      </div>
                    </div>
                    <div className={`diff-sbs-cell ${row.right.type}`}>
                      <div className="sbs-num">{row.right.lineNum ?? ""}</div>
                      <div className="sbs-sign">
                        {row.right.type === "empty" ? "" : signFor(row.right.type)}
                      </div>
                      <div className="sbs-content">
                        {isPaired 
                          ? renderInlineDiff(row.left.content, row.right.content, true)
                          : highlightWhitespaces(row.right.content)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Marcadores de la barra de scroll (Minimap Scrollbar Markers) */}
            {changedIndices.length > 0 && (
              <div 
                style={{
                  position: "absolute",
                  right: "6px", /* justo al lado izquierdo del riel de scroll nativo */
                  top: "4px",
                  bottom: "4px",
                  width: "5px",
                  pointerEvents: "none",
                  zIndex: 20
                }}
              >
                {visibleItems
                  .map((item, idx) => ({ item, idx }))
                  .filter(x => x.item.type === "row" && (x.item.row.left.type !== "equal" || x.item.row.right.type !== "equal"))
                  .map(x => {
                    const isAdded = x.item.type === "row" && x.item.row.right.type === "added";
                    const color = isAdded ? "#10b981" : "#ef4444";
                    const topPercent = (x.idx / visibleItems.length) * 100;
                    return (
                      <div 
                        key={x.idx}
                        style={{
                          position: "absolute",
                          top: `${topPercent}%`,
                          left: 0,
                          right: 0,
                          height: "3px",
                          backgroundColor: color,
                          borderRadius: "2px",
                          boxShadow: `0 0 4px ${color}`
                        }}
                      />
                    );
                  })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Badge de tipo detectado ──────────────────────────────────────────────────
function TypeBadge({ detected }: { detected: DetectedType | null }) {
  if (!detected) return null;
  return (
    <span
      className="type-badge"
      style={{ color: detected.color, borderColor: detected.color + "55" }}
      title={`Tipo detectado automáticamente: ${detected.label}`}
    >
      {detected.icon} {detected.label}
    </span>
  );
}

// ─── Editor de Código con Números de Línea Sincronizados ─────────────────────
interface CodeEditorWithLinesProps {
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  variant: "old" | "new";
}

function CodeEditorWithLines({ value, onChange, placeholder, variant }: CodeEditorWithLinesProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTextareaScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Generamos los números de línea correspondientes
  const lineCount = value.split("\n").length;
  const lines = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1);

  return (
    <div className="code-editor-container">
      <div ref={gutterRef} className="code-editor-gutter" aria-hidden="true">
        {lines.map((num) => (
          <div key={num} className="gutter-line-num">
            {num}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="code-editor-textarea"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleTextareaScroll}
        spellCheck={false}
        id={`textarea-${variant}`}
      />
    </div>
  );
}

// ─── Panel de archivo (izquierdo o derecho) ───────────────────────────────────
interface FilePanelProps {
  label: string;
  variant: "old" | "new";
  value: string;
  onChange: (val: string) => void;
  onFileLoad: (name: string) => void;
}

function FilePanel({ label, variant, value, onChange, onFileLoad }: FilePanelProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (file.size > MAX_SIZE) {
      alert(`El archivo "${file.name}" excede el límite de 10MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      onChange(e.target?.result as string);
      onFileLoad(file.name);
    };
    reader.readAsText(file, "utf-8");
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChange, onFileLoad]
  );

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const isEmpty = !value.trim();

  return (
    <div className="file-panel">
      <div className="file-panel-header">
        <span className={`file-panel-title ${variant}`}>
          {variant === "old" ? "🔴 Archivo Antiguo" : "🟢 Archivo Nuevo"}
          <span style={{ fontWeight: 400, marginLeft: "6px", fontSize: "0.75rem" }}>
            ({label})
          </span>
        </span>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          📁 Subir
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.xml,.config,.env,.txt,.yaml,.yml,.ini,.properties,.sql,.sp,.proc"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <div
        className={`file-drop-zone ${dragging ? "dragging" : ""}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {isEmpty ? (
          <div className={`drop-overlay ${dragging ? "active" : ""}`}>
            <div className="drop-icon">{dragging ? "⬇️" : "📄"}</div>
            <div className="drop-text">
              {dragging
                ? "Suelta el archivo aquí"
                : "Arrastra un archivo aquí\no pega el contenido abajo"}
            </div>
          </div>
        ) : null}

        <CodeEditorWithLines
          value={value}
          onChange={onChange}
          placeholder={
            variant === "old"
              ? "Pega aquí el contenido del archivo en producción..."
              : "Pega aquí el contenido del archivo a desplegar..."
          }
          variant={variant}
        />
      </div>

      {value && (
        <div className="file-actions">
          <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
            {value.split("\n").length} líneas · {(new Blob([value]).size / 1024).toFixed(1)} KB
          </span>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => onChange("")}
            type="button"
          >
            🗑 Limpiar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
// Indica si el nombre fue establecido manualmente (por archivo subido)
// o si puede ser sobreescrito por la detección automática.
export default function FileComparator() {
  const [contenidoAntiguo, setContenidoAntiguo] = useState("");
  const [contenidoNuevo,   setContenidoNuevo]   = useState("");
  const [nombreArchivo,    setNombreArchivo]    = useState("");
  const [nombreManual,     setNombreManual]     = useState(false);
  const [detectedType,     setDetectedType]     = useState<DetectedType | null>(null);
  const [diffRows,  setDiffRows]  = useState<SideBySideRow[] | null>(null);
  const [result,    setResult]    = useState<ValidationResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [showDiff,  setShowDiff]  = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showBlockedModal, setShowBlockedModal] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);

  const canValidate = contenidoAntiguo.trim() && contenidoNuevo.trim();

  // Auto-detectar tipo cuando cambia el contenido (pegar texto)
  useEffect(() => {
    const contenido = contenidoNuevo || contenidoAntiguo;
    if (!contenido.trim()) {
      setDetectedType(null);
      if (!nombreManual) setNombreArchivo("");
      return;
    }

    const detected = detectFileType(contenido, nombreArchivo);
    setDetectedType(detected);

    // Solo auto-completar el nombre si el usuario no escribió uno manualmente
    // Y si el nombre sugerido es diferente al actual, para prevenir re-renders infinitos
    if (!nombreManual && nombreArchivo !== detected.filename) {
      setNombreArchivo(detected.filename);
    }
  }, [contenidoAntiguo, contenidoNuevo, nombreManual, nombreArchivo]);

  // Cuando el usuario sube un archivo con nombre real → marcar como manual
  const handleFileLoad = (name: string) => {
    setNombreArchivo(name);
    setNombreManual(true);
  };

  // Ocultar el diff automáticamente si no se pueden validar los archivos
  useEffect(() => {
    if (!canValidate && showDiff) {
      setShowDiff(false);
      setDiffRows(null);
    }
  }, [canValidate, showDiff]);

  // Recalcular o limpiar diff de forma reactiva
  useEffect(() => {
    if (showDiff && canValidate) {
      setDiffRows(computeSideBySideDiff(contenidoAntiguo, contenidoNuevo));
    } else if (!showDiff) {
      setDiffRows(null);
    }
  }, [contenidoAntiguo, contenidoNuevo, showDiff, canValidate]);

  const handleVerDiff = () => {
    if (!canValidate) return;
    
    if (showDiff) {
      setShowDiff(false);
    } else {
      setShowDiff(true);
      // Desplazar al diff tras unos ms de renderizado
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  const handleValidar = async () => {
    if (!contenidoAntiguo.trim() || !contenidoNuevo.trim()) {
      setError("Por favor proporciona ambos archivos antes de validar.");
      return;
    }

    setError("");
    setResult(null);
    setLoading(true);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        setError("Tu sesión ha expirado. Por favor vuelve a iniciar sesión.");
        setLoading(false);
        return;
      }

      const response = await fetch("/api/validar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          nombre_archivo: nombreArchivo || detectedType?.filename || "archivo",
          contenido_antiguo: contenidoAntiguo,
          contenido_nuevo:   contenidoNuevo,
        }),
      });

      if (response.status === 429) {
        const data = await response.json();
        setError(data.error || "Límite de validaciones alcanzado. Espera un momento.");
        setTimeout(() => {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
        return;
      }
      if (!response.ok) {
        const data = await response.json();
        if (response.status === 403) {
          setShowBlockedModal(true);
          return;
        }
        setError(data.error || "Error al validar. Intenta de nuevo.");
        setTimeout(() => {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
        return;
      }

      const resData = await response.json();
      setResult(resData);
      
      // Auto-desplazar de forma fluida a los resultados del análisis
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);

    } catch {
      setError("Error de conexión. Verifica tu internet e intenta de nuevo.");
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setContenidoAntiguo("");
    setContenidoNuevo("");
    setNombreArchivo("");
    setNombreManual(false);
    setDetectedType(null);
    setDiffRows(null);
    setResult(null);
    setError("");
    setShowDiff(false);
  };

  return (
    <div>
      {/* Fila de acciones (Nombre / Tipo de archivo y botones de control) */}
      <div className="validate-row">
        <div className="form-group file-name-input">
          <label className="form-label" htmlFor="nombre-archivo">
            Nombre / tipo del archivo
          </label>
          <input
            id="nombre-archivo"
            type="text"
            className="form-input"
            value={nombreArchivo}
            onChange={(e) => {
              setNombreArchivo(e.target.value);
              setNombreManual(true); // El usuario escribe → no sobreescribir
            }}
            placeholder="Se detecta automáticamente al pegar contenido…"
          />
          {/* Badge de tipo detectado */}
          <div className="detected-type-row">
            {detectedType ? (
              <>
                <span className="detected-type-label">Detectado:</span>
                <TypeBadge detected={detectedType} />
                {nombreManual && (
                  <button
                    className="btn btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.72rem", opacity: 0.6 }}
                    onClick={() => {
                      setNombreManual(false);
                      if (detectedType) setNombreArchivo(detectedType.filename);
                    }}
                    type="button"
                    title="Usar nombre sugerido por la detección automática"
                  >
                    ↺ Auto
                  </button>
                )}
              </>
            ) : (
              <span className="detected-type-label" style={{ opacity: 0.5 }}>
                Pega o sube un archivo para detectar el tipo automáticamente
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", paddingBottom: "28px" }}>
          <button
            className="btn btn-secondary"
            onClick={handleVerDiff}
            disabled={!canValidate}
            type="button"
          >
            {showDiff ? "👁 Ocultar Diff" : "👁 Ver Diff"}
          </button>

          <button
            className="btn btn-primary btn-lg"
            onClick={() => setShowConfirmModal(true)}
            disabled={!canValidate || loading}
            id="btn-validar"
            type="button"
          >
            {loading ? (
              <>
                <span className="spinner" />
                Analizando con IA...
              </>
            ) : (
              "⚡ Validar con IA"
            )}
          </button>

          {(contenidoAntiguo || contenidoNuevo) && (
            <button className="btn btn-secondary" onClick={handleReset} type="button">
              ↩ Resetear
            </button>
          )}
        </div>
      </div>

      {/* Paneles de archivos (Antes y Después) */}
      <div className="comparator-grid">
        <FilePanel
          label="producción"
          variant="old"
          value={contenidoAntiguo}
          onChange={setContenidoAntiguo}
          onFileLoad={handleFileLoad}
        />
        <FilePanel
          label="a desplegar"
          variant="new"
          value={contenidoNuevo}
          onChange={setContenidoNuevo}
          onFileLoad={handleFileLoad}
        />
      </div>

      {/* Contenedor de anclaje para scroll automático */}
      <div ref={resultRef} style={{ scrollMarginTop: "100px" }}>
        {/* Error */}
        {error && (
          <div className="alert alert-error" role="alert" style={{ marginTop: "16px" }}>
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Resultado IA (Ahora arriba para lectura y scroll inmediato) */}
        {result && <ValidationResultPanel result={result} nombreArchivo={nombreArchivo || detectedType?.filename || "archivo"} />}

        {/* Diff viewer (Abajo para consulta detallada de código) */}
        {showDiff && diffRows !== null && <DiffViewer rows={diffRows} />}
      </div>

      {/* Modal de Confirmación de IA */}
      {showConfirmModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <span className="modal-icon">🤖</span>
              <h3 className="modal-title">¿Validar con IA o ver Diff?</h3>
            </div>
            <p className="modal-text">
              La validación con IA realiza un análisis semántico de seguridad y sintaxis que consume cuota de tokens. Si solo necesitas comparar las diferencias de código visualmente, puedes usar <strong>Ver Diff</strong>.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowConfirmModal(false);
                  handleValidar();
                }}
                type="button"
              >
                ⚡ Validar con IA
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowConfirmModal(false);
                  if (!showDiff) {
                    handleVerDiff();
                  }
                }}
                type="button"
              >
                👁️ Solo ver Diff
              </button>
              <button
                className="btn btn-text"
                onClick={() => setShowConfirmModal(false)}
                type="button"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  padding: "6px 12px"
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Bloqueo de IA (Acceso Denegado) */}
      {showBlockedModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ border: "1px solid var(--color-error-border)", maxWidth: "440px" }}>
            <div className="modal-header" style={{ marginBottom: "12px" }}>
              <span className="modal-icon" style={{ color: "var(--color-error)" }}>🚫</span>
              <h3 className="modal-title" style={{ color: "var(--color-text)" }}>Acceso Denegado</h3>
            </div>
            <p className="modal-text" style={{ fontSize: "0.92rem", lineHeight: "1.6", color: "var(--color-text-subtle)", margin: "0 0 20px 0" }}>
              Tu usuario no tiene permitido validar con IA. Por favor, contacta a un administrador para solicitar el acceso.
            </p>
            <div className="modal-actions" style={{ justifyContent: "flex-end", gap: "10px" }}>
              <a
                href={`https://wa.me/51964972584?text=${encodeURIComponent(
                  "Hola, solicito habilitar mi acceso para validar con IA en la plataforma ValidaDoc."
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
                style={{
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.85rem",
                  textDecoration: "none",
                  padding: "10px 16px",
                }}
              >
                💬 Solicitar por WhatsApp
              </a>
              <button
                className="btn btn-primary"
                onClick={() => setShowBlockedModal(false)}
                type="button"
                style={{
                  background: "linear-gradient(135deg, var(--color-error), #dc2626)",
                  boxShadow: "0 4px 14px rgba(239, 68, 68, 0.3)",
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
