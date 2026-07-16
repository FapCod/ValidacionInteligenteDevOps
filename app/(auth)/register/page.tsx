// app/(auth)/register/page.tsx
import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Crear cuenta — ValidaDoc",
  description: "Regístrate para comenzar a validar archivos de configuración con IA",
};

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
