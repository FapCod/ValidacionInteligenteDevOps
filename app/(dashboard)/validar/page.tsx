// app/(dashboard)/validar/page.tsx
import type { Metadata } from "next";
import FileComparator from "@/components/FileComparator";

export const metadata: Metadata = {
  title: "Validador — ValidaDoc",
  description: "Compara y valida configuraciones, Stored Procedures SQL, scripts y cualquier archivo antes de desplegar",
};

export default function ValidarPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span>Validador Inteligente de Archivos</span>
        </h1>
        <p className="page-subtitle">
          Compara versiones de <strong>archivos de configuración</strong>, 
          <strong> Stored Procedures SQL</strong>, scripts, .env y cualquier documento
          antes del pase a producción. La IA detecta errores de sintaxis, cambios
          estructurales sospechosos y problemas de SQL.
        </p>
      </div>

      <FileComparator />
    </div>
  );
}
