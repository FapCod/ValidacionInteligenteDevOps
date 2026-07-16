"use client";
// components/FileComparator.tsx
// Componente principal: carga de archivos, drag & drop, diff visual y llamada a IA

import { useState, useCallback, useRef, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { computeSideBySideDiff } from "@/lib/diff";
import { detectFileType, type DetectedType } from "@/lib/detectFileType";
import ValidationResultPanel from "@/components/ValidationResult";
import type { SideBySideRow, ValidationResult } from "@/types";

const MAX_SIZE = 200 * 1024; // 200KB

// ─── Diff Side-by-Side Viewer ─────────────────────────────────────────────────
function DiffViewer({ rows }: { rows: SideBySideRow[] }) {
  const addedCount   = rows.filter((r) => r.right.type === "added").length;
  const removedCount = rows.filter((r) => r.left.type  === "removed").length;

  const signFor = (type: string) =>
    type === "added" ? "+" : type === "removed" ? "−" : " ";

  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <span className="diff-title">📊 Diff Side-by-Side</span>
        <div className="diff-stats">
          <span className="added">+{addedCount} líneas agregadas</span>
          <span className="removed">−{removedCount} líneas eliminadas</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: "32px",
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.85rem",
          }}
        >
          Los archivos son idénticos — no hay diferencias
        </div>
      ) : (
        <>
          <div className="diff-col-headers">
            <div className="diff-col-header old">🔴 Versión Anterior (Producción)</div>
            <div className="diff-col-header new">🟢 Versión Nueva (A desplegar)</div>
          </div>
          <div className="diff-sbs-scroll" aria-label="Diff side-by-side">
            {rows.map((row, i) => (
              <div key={i} className="diff-sbs-row">
                <div className={`diff-sbs-cell ${row.left.type}`}>
                  <div className="sbs-num">{row.left.lineNum ?? ""}</div>
                  <div className="sbs-sign">
                    {row.left.type === "empty" ? "" : signFor(row.left.type)}
                  </div>
                  <div className="sbs-content">{row.left.content}</div>
                </div>
                <div className={`diff-sbs-cell ${row.right.type}`}>
                  <div className="sbs-num">{row.right.lineNum ?? ""}</div>
                  <div className="sbs-sign">
                    {row.right.type === "empty" ? "" : signFor(row.right.type)}
                  </div>
                  <div className="sbs-content">{row.right.content}</div>
                </div>
              </div>
            ))}
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
      alert(`El archivo "${file.name}" excede el límite de 200KB.`);
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

  // Auto-detectar tipo cuando cambia el contenido (pegar texto)
  useEffect(() => {
    const contenido = contenidoNuevo || contenidoAntiguo;
    if (!contenido.trim()) {
      setDetectedType(null);
      if (!nombreManual) setNombreArchivo("");
      return;
    }

    const detected = detectFileType(contenido);
    setDetectedType(detected);

    // Solo auto-completar el nombre si el usuario no escribió uno manualmente
    if (!nombreManual) {
      setNombreArchivo(detected.filename);
    }
  }, [contenidoAntiguo, contenidoNuevo, nombreManual]);

  // Cuando el usuario sube un archivo con nombre real → marcar como manual
  const handleFileLoad = (name: string) => {
    setNombreArchivo(name);
    setNombreManual(true);
  };

  const handleVerDiff = () => {
    if (!contenidoAntiguo && !contenidoNuevo) return;
    setDiffRows(computeSideBySideDiff(contenidoAntiguo, contenidoNuevo));
    setShowDiff(true);
  };

  const handleValidar = async () => {
    if (!contenidoAntiguo.trim() || !contenidoNuevo.trim()) {
      setError("Por favor proporciona ambos archivos antes de validar.");
      return;
    }

    setError("");
    setResult(null);
    setLoading(true);

    if (!showDiff) {
      setDiffRows(computeSideBySideDiff(contenidoAntiguo, contenidoNuevo));
      setShowDiff(true);
    }

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
        return;
      }
      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Error al validar. Intenta de nuevo.");
        return;
      }

      setResult(await response.json());
    } catch {
      setError("Error de conexión. Verifica tu internet e intenta de nuevo.");
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

  const canValidate = contenidoAntiguo.trim() && contenidoNuevo.trim();

  return (
    <div>
      {/* Paneles de archivos */}
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

      {/* Fila de acciones */}
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
            👁 Ver Diff
          </button>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleValidar}
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

      {/* Error */}
      {error && (
        <div className="alert alert-error" role="alert">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Diff viewer */}
      {showDiff && diffRows !== null && <DiffViewer rows={diffRows} />}

      {/* Resultado IA */}
      {result && <ValidationResultPanel result={result} />}
    </div>
  );
}
