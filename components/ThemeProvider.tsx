"use client";
// components/ThemeProvider.tsx
// Contexto y proveedor global para el tema claro/oscuro y su animación de velo

import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextProps {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [animating, setAnimating] = useState(false);
  const [targetTheme, setTargetTheme] = useState<Theme>("dark");

  useEffect(() => {
    // Leer el tema guardado en localStorage o usar el tema predeterminado oscuro
    const storedTheme = localStorage.getItem("theme") as Theme | null;
    if (storedTheme) {
      setTheme(storedTheme);
      document.documentElement.className = storedTheme;
    } else {
      document.documentElement.className = "dark";
    }
  }, []);

  const toggleTheme = () => {
    if (animating) return;

    const nextTheme = theme === "dark" ? "light" : "dark";
    setTargetTheme(nextTheme);
    setAnimating(true);

    // Iniciar la transición del velo:
    // Esperamos 450ms (punto central en que la pantalla está 100% cubierta) para conmutar las clases CSS
    setTimeout(() => {
      setTheme(nextTheme);
      localStorage.setItem("theme", nextTheme);
      document.documentElement.className = nextTheme;
    }, 450);

    // Finalizar animación después del swipe completo (900ms)
    setTimeout(() => {
      setAnimating(false);
    }, 900);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
      {/* Cortina de transición teatral dividida global */}
      {animating && (
        <div className={`theme-curtain-overlay ${animating ? "active" : ""}`}>
          <div className={`curtain-panel curtain-left ${targetTheme}`} />
          <div className={`curtain-panel curtain-right ${targetTheme}`} />
        </div>
      )}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme debe usarse dentro de un ThemeProvider");
  }
  return context;
}
