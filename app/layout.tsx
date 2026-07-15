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
      <body>{children}</body>
    </html>
  );
}
