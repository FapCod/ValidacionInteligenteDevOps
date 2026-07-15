"use client";
// components/ValidationResult.tsx

import type { ValidationResult } from "@/types";

interface Props {
  result: ValidationResult;
}

export default function ValidationResultPanel({ result }: Props) {
  const { valido, errores, advertencias, resumen } = result;

  return (
    <div className={`result-card ${valido ? "valid" : "invalid"}`}>
      {/* Header */}
      <div className="result-header">
        <div className="result-icon">{valido ? "✅" : "❌"}</div>
        <div>
          <div className="result-title">
            {valido
              ? "Archivo válido — Listo para desplegar"
              : "Archivo inválido — No desplegar"}
          </div>
          <div className="result-subtitle">
            {valido
              ? "La IA no detectó problemas críticos en el archivo nuevo"
              : `Se detectaron ${errores.length} error${errores.length !== 1 ? "es" : ""} crítico${errores.length !== 1 ? "s" : ""}`}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="result-body">
        {/* Errores */}
        {errores.length > 0 && (
          <div className="result-section">
            <div className="result-section-title" style={{ color: "#ef4444" }}>
              🚨 Errores críticos ({errores.length})
            </div>
            <ul className="result-list errors">
              {errores.map((err, i) => (
                <li key={i}>
                  <span style={{ flexShrink: 0 }}>❌</span>
                  <span>{err}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Advertencias */}
        {advertencias.length > 0 && (
          <div className="result-section">
            <div className="result-section-title" style={{ color: "#f59e0b" }}>
              ⚠️ Advertencias ({advertencias.length})
            </div>
            <ul className="result-list warnings">
              {advertencias.map((warn, i) => (
                <li key={i}>
                  <span style={{ flexShrink: 0 }}>⚠️</span>
                  <span>{warn}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Sin problemas */}
        {errores.length === 0 && advertencias.length === 0 && (
          <div className="result-section">
            <div
              className="result-list"
              style={{
                padding: "14px",
                background: "rgba(16,185,129,0.1)",
                borderRadius: "8px",
                border: "1px solid rgba(16,185,129,0.2)",
                color: "#34d399",
                fontSize: "0.9rem",
              }}
            >
              No se encontraron errores ni advertencias. El archivo está limpio.
            </div>
          </div>
        )}

        {/* Resumen */}
        {resumen && (
          <div className="result-section">
            <div className="result-section-title">📋 Resumen de la IA</div>
            <div className="result-summary">{resumen}</div>
          </div>
        )}
      </div>
    </div>
  );
}
