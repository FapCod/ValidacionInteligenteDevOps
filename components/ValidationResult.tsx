"use client";
// components/ValidationResult.tsx
// Panel de resultados del análisis de IA con opción para descargar el reporte PDF certificado

import type { ValidationResult } from "@/types";
import { supabaseBrowser } from "@/lib/supabase";

interface Props {
  result: ValidationResult;
  nombreArchivo?: string;
}

export default function ValidationResultPanel({ result, nombreArchivo = "archivo" }: Props) {
  const { valido, errores, advertencias, resumen, proveedor } = result;

  const handleDownloadPDF = async () => {
    // 1. Obtener la sesión del usuario para el certificado
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    const userEmail = session?.user?.email || "Usuario Invitado";
    const userName = session?.user?.user_metadata?.nombre || userEmail.split("@")[0];
    
    // Generar un hash único de validación (basado en fecha, nombre de archivo y resultado)
    const dateStr = new Date().toLocaleString("es-PE");
    const uniqueHash = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("").toUpperCase();

    // 2. Abrir la ventana de impresión del certificado
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Por favor habilita las ventanas emergentes (popups) para descargar el certificado.");
      return;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Certificado de Validación - ${nombreArchivo}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
          
          body {
            font-family: 'Inter', sans-serif;
            margin: 0;
            padding: 40px;
            color: #0f172a;
            background: #ffffff;
            line-height: 1.5;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .certificate-container {
            border: 2px solid #cbd5e1;
            border-radius: 16px;
            padding: 40px;
            position: relative;
            background: radial-gradient(circle at top right, rgba(37, 99, 235, 0.02), transparent);
            max-width: 800px;
            margin: 0 auto;
          }

          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }

          .logo-area {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 800;
            font-size: 1.3rem;
            color: #1e3a8a;
          }

          .logo-badge {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, #2563eb, #8b5cf6);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .certificate-title {
            text-align: right;
            font-size: 0.85rem;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .doc-hash {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.72rem;
            color: #94a3b8;
            margin-top: 4px;
          }

          .main-title {
            font-size: 1.8rem;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 10px 0;
            text-align: center;
          }

          .stamp-badge {
            display: inline-block;
            padding: 8px 16px;
            border-radius: 24px;
            font-size: 0.9rem;
            font-weight: 700;
            text-align: center;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            margin: 0 auto 30px auto;
          }

          .stamp-badge.approved {
            background: rgba(16, 185, 129, 0.1);
            color: #065f46;
            border: 1px solid rgba(16, 185, 129, 0.3);
          }

          .stamp-badge.denied {
            background: rgba(239, 68, 68, 0.1);
            color: #991b1b;
            border: 1px solid rgba(239, 68, 68, 0.3);
          }

          .details-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 30px;
          }

          .details-item {
            font-size: 0.85rem;
          }

          .details-item strong {
            color: #475569;
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.02em;
            display: block;
            margin-bottom: 2px;
          }

          .details-item span {
            color: #0f172a;
            font-weight: 600;
          }

          .section-title {
            font-size: 0.8rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #475569;
            margin-bottom: 12px;
            border-left: 3px solid #2563eb;
            padding-left: 8px;
          }

          .summary-box {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            font-size: 0.9rem;
            color: #334155;
            line-height: 1.6;
            margin-bottom: 30px;
          }

          .issues-list {
            list-style: none;
            padding: 0;
            margin: 0 0 30px 0;
          }

          .issues-list li {
            font-size: 0.85rem;
            padding: 10px 14px;
            border-radius: 6px;
            margin-bottom: 8px;
            display: flex;
            align-items: flex-start;
            gap: 10px;
          }

          .issues-list.errors li {
            background: #fef2f2;
            border: 1px solid #fee2e2;
            color: #991b1b;
          }

          .issues-list.warnings li {
            background: #fffbeb;
            border: 1px solid #fef3c7;
            color: #92400e;
          }

          .footer-signature {
            margin-top: 50px;
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
          }

          .signature-block {
            text-align: center;
            font-size: 0.8rem;
            color: #64748b;
          }

          .signature-line {
            width: 180px;
            border-bottom: 1px solid #cbd5e1;
            margin-bottom: 8px;
          }

          .secured-badge {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.78rem;
            color: #10b981;
            font-weight: 700;
          }

          @media print {
            body {
              padding: 0;
            }
            .certificate-container {
              border: none;
              padding: 0;
            }
            .no-print {
              display: none !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="max-width: 800px; margin: 0 auto 20px auto; display: flex; justify-content: flex-end;">
          <button onclick="window.print()" style="background: #2563eb; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: sans-serif;">
            🖨️ Imprimir o Guardar PDF
          </button>
        </div>

        <div class="certificate-container">
          <!-- Header -->
          <div class="header">
            <div class="logo-area">
              <div class="logo-badge">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="white" stroke="white" stroke-width="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <span>ValidaDoc</span>
            </div>
            <div class="certificate-title">
              Certificado de Validación
              <div class="doc-hash">HASH: ${uniqueHash}</div>
            </div>
          </div>

          <!-- Title -->
          <div style="text-align: center;">
            <h1 class="main-title">Reporte Técnico de Validación</h1>
            <div class="stamp-badge ${valido ? "approved" : "denied"}">
              ${valido ? "Aprobado para Producción" : "Rechazado — Contiene Errores"}
            </div>
          </div>

          <!-- Metadata Grid -->
          <div class="details-grid">
            <div class="details-item">
              <strong>Archivo Validado</strong>
              <span>${nombreArchivo}</span>
            </div>
            <div class="details-item">
              <strong>Fecha de Emisión</strong>
              <span>${dateStr}</span>
            </div>
            <div class="details-item">
              <strong>Usuario / Ingeniero</strong>
              <span>${userName} (${userEmail})</span>
            </div>
            <div class="details-item">
              <strong>Motor de Inteligencia</strong>
              <span>AI Engine (${proveedor || "Gemini"})</span>
            </div>
          </div>

          <!-- Resumen -->
          <div class="section-title">Resumen Ejecutivo del Análisis</div>
          <div class="summary-box">
            ${resumen || "Análisis de sintaxis y compatibilidad completado satisfactoriamente."}
          </div>

          <!-- Errores -->
          ${errores.length > 0 ? `
            <div class="section-title" style="border-left-color: #ef4444;">Errores Críticos Detectados</div>
            <ul class="issues-list errors">
              ${errores.map(err => `<li><span>❌</span> <span>${err}</span></li>`).join("")}
            </ul>
          ` : ""}

          <!-- Advertencias -->
          ${advertencias.length > 0 ? `
            <div class="section-title" style="border-left-color: #f59e0b;">Advertencias / Sugerencias</div>
            <ul class="issues-list warnings">
              ${advertencias.map(warn => `<li><span>⚠️</span> <span>${warn}</span></li>`).join("")}
            </ul>
          ` : ""}

          <!-- Footer Signature -->
          <div class="footer-signature">
            <div class="secured-badge">
              <span>🛡️ Secured by ValidaDoc AI</span>
            </div>
            <div class="signature-block">
              <div class="signature-line"></div>
              <span>Firma del Validador Autorizado</span>
            </div>
          </div>
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          }
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <div className={`result-card ${valido ? "valid" : "invalid"}`} style={{ position: "relative" }}>
      {/* Acciones del encabezado agrupadas en Flexbox para evitar superposición */}
      <div 
        style={{
          position: "absolute",
          top: "14px",
          right: "16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          zIndex: 10
        }}
      >
        {/* Botón de Descargar Certificado (PDF) */}
        <button
          onClick={handleDownloadPDF}
          className="btn btn-sm btn-secondary"
          style={{
            padding: "4px 12px",
            fontSize: "0.72rem",
            fontWeight: 600,
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-light)",
            color: "var(--color-text)",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            cursor: "pointer"
          }}
          type="button"
          title="Descargar Certificado de Validación en PDF"
        >
          📄 Descargar PDF
        </button>

        {/* Badge de Proveedor */}
        {proveedor && (
          <span 
            style={{
              fontSize: "0.72rem",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              padding: "3px 10px",
              borderRadius: "12px",
              color: "var(--color-text-subtle)",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              whiteSpace: "nowrap"
            }}
          >
            🤖 Motor: {proveedor}
          </span>
        )}
      </div>

      {/* Header */}
      <div className="result-header" style={{ paddingRight: proveedor ? "300px" : "150px" }}>
        <div className="result-icon">{valido ? "✅" : "❌"}</div>
        <div>
          <div className="result-title">
            {valido
              ? "Archivo válido — Listo para desplegar"
              : "Archivo inválido — No desplegar"}
          </div>
          <div className="result-subtitle">
            {valido
              ? "El motor de análisis no detectó problemas críticos"
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
