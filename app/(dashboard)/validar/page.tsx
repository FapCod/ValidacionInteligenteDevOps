// app/(dashboard)/validar/page.tsx
import type { Metadata } from "next";
import FileComparator from "@/components/FileComparator";

export const metadata: Metadata = {
  title: "Validador — ValidaConfig",
  description: "Compara archivos de configuración y detecta errores con IA antes de desplegar",
};

export default function ValidarPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Validador de Configuraciones</h1>
        <p className="page-subtitle">
          Sube o pega tus archivos, genera el diff visual y deja que la IA
          detecte errores antes de hacer el pase a producción.
        </p>
      </div>

      <FileComparator />
    </div>
  );
}
