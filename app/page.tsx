// app/page.tsx
// Ruta raíz → redirige según estado de sesión
import { redirect } from "next/navigation";

export default function RootPage() {
  // Redirigir a la página principal del dashboard
  // El middleware o el layout del dashboard maneja la protección de ruta
  redirect("/validar");
}
