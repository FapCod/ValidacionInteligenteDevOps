"use client";
// app/(dashboard)/layout.tsx
// Layout protegido: verifica sesión activa antes de renderizar

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser, getBrowserClient } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import type { User } from "@supabase/supabase-js";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [esAdmin, setEsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Verificar sesión activa
    supabaseBrowser.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
      } else {
        setUser(session.user);

        // Consultar es_admin desde la tabla usuarios
        try {
          const { data } = await getBrowserClient()
            .from("usuarios")
            .select("es_admin")
            .eq("id", session.user.id)
            .single();
          
          if (data?.es_admin) {
            setEsAdmin(true);
          }
        } catch (err) {
          console.error("Error al obtener perfil de usuario:", err);
        }

        setChecking(false);
      }
    });

    // Escuchar cambios de sesión (logout desde otra pestaña, etc.)
    const {
      data: { subscription },
    } = supabaseBrowser.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        router.replace("/login");
        setEsAdmin(false);
      } else {
        setUser(session.user);

        // Consultar es_admin tras cambio de sesión
        try {
          const { data } = await getBrowserClient()
            .from("usuarios")
            .select("es_admin")
            .eq("id", session.user.id)
            .single();
          
          setEsAdmin(!!data?.es_admin);
        } catch {
          setEsAdmin(false);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (checking) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-bg)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            className="spinner"
            style={{
              width: "36px",
              height: "36px",
              borderWidth: "3px",
              margin: "0 auto 16px",
            }}
          />
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>
            Verificando sesión...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <Navbar userEmail={user?.email} esAdmin={esAdmin} />
      <main className="main-content">{children}</main>
    </div>
  );
}
