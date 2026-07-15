"use client";
// components/FileComparator.tsx
// Componente principal: carga de archivos, drag & drop, diff visual y llamada a IA

import { useState, useCallback, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { computeDiff } from "@/lib/diff";
import ValidationResultPanel from "@/components/ValidationResult";
import type { DiffLine, ValidationResult } from "@/types";

const MAX_SIZE = 200 * 1024; // 200KB

function DiffViewer({ lines }: { lines: DiffLine[] }) {
  const addedCount = lines.filter((l) => l.type === "added").length;
  const removedCount = lines.filter((l) => l.type === "removed").length;

  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <span className="diff-title">📊 Diff Visual</span>
        <div className="diff-stats">
          <span className="added">+{addedCount} líneas agregadas</span>
          <span className="removed">−{removedCount} líneas eliminadas</span>
        </div>
      </div>

      <div className="diff-table" aria-label="Diff de archivos">
        {lines.length === 0 ? (
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
          lines.map((line, i) => (
            <div key={i} className={`diff-row ${line.type}`}>
              {/* Número línea antiguo */}
              <div className="diff-line-num">
                {line.lineOld ?? ""}
              </div>
              {/* Número línea nuevo */}
              <div className="diff-line-num">
                {line.lineNew ?? ""}
              </div>
              {/* Signo +/- */}
              <div className="diff-sign">
                {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
              </div>
              {/* Contenido */}
              <div className="diff-content">{line.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

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

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
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
          accept=".json,.xml,.config,.env,.txt,.yaml,.yml,.ini,.properties"
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

        <textarea
          className="file-textarea"
          placeholder={
            variant === "old"
              ? "Pega aquí el contenido del archivo en producción..."
              : "Pega aquí el contenido del archivo a desplegar..."
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          id={`textarea-${variant}`}
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

export default function FileComparator() {
  const [contenidoAntiguo, setContenidoAntiguo] = useState("");
  const [contenidoNuevo, setContenidoNuevo] = useState("");
  const [nombreArchivo, setNombreArchivo] = useState("configuracion.json");
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDiff, setShowDiff] = useState(false);

  // Genera diff en tiempo real cuando el usuario hace clic en "Ver Diff"
  const handleVerDiff = () => {
    if (!contenidoAntiguo && !contenidoNuevo) return;
    setDiffLines(computeDiff(contenidoAntiguo, contenidoNuevo));
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

    // Generar diff si no está visible
    if (!showDiff) {
      setDiffLines(computeDiff(contenidoAntiguo, contenidoNuevo));
      setShowDiff(true);
    }

    try {
      // Obtener el token de sesión activo del usuario
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();

      if (!session) {
        setError("Tu sesión ha expirado. Por favor vuelve a iniciar sesión.");
        return;
      }

      // Llamar al endpoint interno — la GEMINI_API_KEY nunca sale del servidor
      const response = await fetch("/api/validar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // El token JWT se envía para que el servidor lo verifique
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          nombre_archivo: nombreArchivo,
          contenido_antiguo: contenidoAntiguo,
          contenido_nuevo: contenidoNuevo,
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

      const data = await response.json();
      setResult(data);
    } catch {
      setError("Error de conexión. Verifica tu internet e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setContenidoAntiguo("");
    setContenidoNuevo("");
    setDiffLines(null);
    setResult(null);
    setError("");
    setShowDiff(false);
  };

  const canValidate = contenidoAntiguo.trim() && contenidoNuevo.trim();

  return (
    <div>
      {/* File panels */}
      <div className="comparator-grid">
        <FilePanel
          label="producción"
          variant="old"
          value={contenidoAntiguo}
          onChange={setContenidoAntiguo}
          onFileLoad={(name) => setNombreArchivo(name)}
        />
        <FilePanel
          label="a desplegar"
          variant="new"
          value={contenidoNuevo}
          onChange={setContenidoNuevo}
          onFileLoad={(name) => setNombreArchivo(name)}
        />
      </div>

      {/* Action row */}
      <div className="validate-row">
        <div className="form-group file-name-input">
          <label className="form-label" htmlFor="nombre-archivo">
            Nombre del archivo
          </label>
          <input
            id="nombre-archivo"
            type="text"
            className="form-input"
            value={nombreArchivo}
            onChange={(e) => setNombreArchivo(e.target.value)}
            placeholder="web.config"
          />
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
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
            <button
              className="btn btn-secondary"
              onClick={handleReset}
              type="button"
            >
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
      {showDiff && diffLines !== null && <DiffViewer lines={diffLines} />}

      {/* AI Result */}
      {result && <ValidationResultPanel result={result} />}
    </div>
  );
}
