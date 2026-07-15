"use client";
// components/Navbar.tsx

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase";
import { useState } from "react";

interface NavbarProps {
  userEmail?: string;
}

export default function Navbar({ userEmail }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

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
          <div className="logo-icon">⚡</div>
          <span>ValidaConfig</span>
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
        </div>

        {/* User info + Sign out */}
        <div className="navbar-user">
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
