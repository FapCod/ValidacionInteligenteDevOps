// app/(auth)/forgot-password/page.tsx
import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Recuperar contraseña — ValidaConfig",
  description: "Restablece tu contraseña para volver a validar tus archivos de configuración",
};

export default function ForgotPasswordPage() {
  return <AuthForm mode="forgot-password" />;
}
