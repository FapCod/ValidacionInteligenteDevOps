// app/(auth)/login/page.tsx
import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Iniciar sesión — ValidaConfig",
  description: "Accede a tu cuenta para validar archivos de configuración con IA",
};

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
