// app/layout.tsx
import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "ValidaDoc — Validador Inteligente de Archivos",
  description:
    "Compara y valida archivos de configuración, Stored Procedures SQL, scripts y documentos usando IA antes de hacer un pase a producción.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        {children}
        
        {/* Pantalla de Bloqueo Móvil */}
        <div className="mobile-blocker">
          <div className="mobile-blocker-card">
            <div className="mobile-blocker-icon">💻</div>
            <h1 className="mobile-blocker-title">ValidaDoc está optimizado para Desktop</h1>
            <p className="mobile-blocker-text">
              Para realizar comparaciones lado a lado y análisis de código complejos, por el momento esta plataforma sólo es compatible con pantallas de escritorio (Desktop).
            </p>
            <div className="mobile-blocker-badge">Recomendado: 1024px o más</div>
          </div>
        </div>
      </body>
    </html>
  );
}
