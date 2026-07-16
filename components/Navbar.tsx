"use client";
// components/Navbar.tsx

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase";
import { useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

interface NavbarProps {
  userEmail?: string;
  esAdmin?: boolean;
}

export default function Navbar({ userEmail, esAdmin = false }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabaseBrowser.auth.signOut();
    router.push("/login");
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        {/* Logo */}
        <Link href="/validar" className="navbar-logo">
          <div className="logo-icon">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="white"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "block" }}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <span>ValidaDoc</span>
        </Link>

        {/* Navigation Links */}
        <div className="navbar-nav">
          <Link
            href="/validar"
            className={`nav-link ${pathname === "/validar" ? "active" : ""}`}
          >
            🔍 Validador
          </Link>
          <Link
            href="/historial"
            className={`nav-link ${pathname === "/historial" ? "active" : ""}`}
          >
            📋 Historial
          </Link>
          {esAdmin && (
            <Link
              href="/admin"
              className={`nav-link ${pathname === "/admin" ? "active" : ""}`}
            >
              🛡️ Admin
            </Link>
          )}
        </div>

        {/* User info + Sign out */}
        <div className="navbar-user">
          <button
            onClick={toggleTheme}
            type="button"
            className="btn btn-sm btn-secondary"
            title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            style={{
              padding: "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              width: "36px",
              height: "36px",
              fontSize: "1.1rem",
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border-light)",
              cursor: "pointer",
            }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {userEmail && (
            <span className="user-badge" title={userEmail}>
              {userEmail.split("@")[0]}
            </span>
          )}
          <button
            className="btn btn-sm btn-secondary"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? "..." : "Salir"}
          </button>
        </div>
      </div>
    </nav>
  );
}
