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
        <h1 className="page-title">📄 Validador Inteligente de Archivos</h1>
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
