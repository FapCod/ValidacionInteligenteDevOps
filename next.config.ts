import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bloquea que variables server-only sean accesibles desde el cliente
  serverExternalPackages: ["@google/generative-ai"],
};

export default nextConfig;
