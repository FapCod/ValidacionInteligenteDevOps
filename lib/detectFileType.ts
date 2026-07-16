// lib/detectFileType.ts
// Detecta el tipo de archivo/sintaxis basado en el contenido del texto.
// Se usa para auto-completar el campo "Nombre del archivo" cuando el
// usuario pega contenido en lugar de subir un archivo con nombre.

export interface DetectedType {
  label: string;       // Etiqueta visible: "SQL Script", "JSON", etc.
  filename: string;    // Nombre de archivo sugerido
  icon: string;        // Emoji representativo
  color: string;       // Color CSS para la badge
}

export function detectFileType(content: string, filename?: string): DetectedType {
  const text = content.trim();

  // Si hay un nombre de archivo, priorizar la extensión ya que es la verdad absoluta del sistema de archivos
  if (filename && filename.trim()) {
    const cleanName = filename.trim().toLowerCase();
    const ext = cleanName.split(".").pop();

    if (ext === "sql" || ext === "sp" || ext === "proc") {
      return TYPES.sql;
    }
    if (ext === "xml" || ext === "config" || ext === "csproj") {
      return TYPES.xml;
    }
    if (ext === "json") {
      return TYPES.json;
    }
    if (ext === "yaml" || ext === "yml") {
      return TYPES.yaml;
    }
    if (ext === "env" || cleanName.includes(".env")) {
      return TYPES.env;
    }
    if (ext === "ini" || ext === "properties") {
      return TYPES.ini;
    }
    if (ext === "txt") {
      return TYPES.txt;
    }
  }

  if (!text) return TYPES.unknown;

  // 1. XML / web.config / app.config (Estructura muy específica e inequívoca)
  if (isXml(text))        return TYPES.xml;

  // 2. JSON (appsettings.json, package.json, etc. - Sintaxis exacta)
  if (isJson(text))       return TYPES.json;

  // 3. SQL — Stored Procedures y scripts SQL (Heurística de palabras clave)
  if (isSql(text))        return TYPES.sql;

  // 4. YAML (.yml / .yaml)
  if (isYaml(text))       return TYPES.yaml;

  // 5. Variables de entorno (.env)
  if (isEnv(text))        return TYPES.env;

  // 6. INI / Properties (key=value o key: value simple)
  if (isIni(text))        return TYPES.ini;

  // 7. Texto plano
  return TYPES.txt;
}

// ─── Detectores individuales ─────────────────────────────────────────────────

function isSql(text: string): boolean {
  const upper = text.toUpperCase();

  // Palabras clave SQL fuertes — si tiene 2 o más es casi seguro SQL
  const strongKeywords = [
    "CREATE PROCEDURE", "CREATE PROC", "ALTER PROCEDURE", "ALTER PROC",
    "CREATE FUNCTION", "ALTER FUNCTION", "CREATE TABLE", "ALTER TABLE",
    "CREATE INDEX", "CREATE VIEW", "CREATE TRIGGER",
    "DROP TABLE", "DROP PROCEDURE",
    "BEGIN TRANSACTION", "COMMIT TRANSACTION", "ROLLBACK",
    "DECLARE @", "SET @", "EXEC ", "EXECUTE ",
  ];

  const weakKeywords = [
    "SELECT ", "INSERT INTO", "UPDATE ", "DELETE FROM",
    "FROM ", "WHERE ", "JOIN ", "INNER JOIN", "LEFT JOIN",
    "GROUP BY", "ORDER BY", "HAVING ",
    "UNION ", "WITH ", "AS (", "END;", "BEGIN\n",
  ];

  const strongMatches = strongKeywords.filter(k => upper.includes(k)).length;
  if (strongMatches >= 1) return true;

  const weakMatches = weakKeywords.filter(k => upper.includes(k)).length;
  return weakMatches >= 2;
}

function isXml(text: string): boolean {
  const trimmed = text.trimStart();
  // Empieza con declaración XML, doctype, o tag
  if (trimmed.startsWith("<?xml")) return true;
  if (trimmed.startsWith("<!--"))  return true;
  // Tiene al menos un par de tags bien formados
  const tagPattern = /<[a-zA-Z][a-zA-Z0-9._-]*[\s>]/;
  const closePattern = /<\/[a-zA-Z][a-zA-Z0-9._-]*>/;
  return tagPattern.test(text) && closePattern.test(text);
}

function isJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function isYaml(text: string): boolean {
  const lines = text.split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  if (lines.length < 2) return false;

  // YAML: líneas con "key: value" o "- item"
  const yamlLinePattern = /^[ \t]*[a-zA-Z_][a-zA-Z0-9_-]*\s*:/;
  const listLinePattern  = /^[ \t]*-\s+/;

  const yamlLines = lines.filter(l => yamlLinePattern.test(l) || listLinePattern.test(l));
  return yamlLines.length >= Math.ceil(lines.length * 0.4); // ≥40% de líneas son YAML
}

function isEnv(text: string): boolean {
  const lines = text.split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  if (lines.length === 0) return false;

  // .env: KEY=VALUE o KEY="VALUE" o export KEY=VALUE
  const envPattern = /^(export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*.*/;
  const envLines = lines.filter(l => envPattern.test(l.trim()));
  return envLines.length >= Math.ceil(lines.length * 0.5); // ≥50% son env vars
}

function isIni(text: string): boolean {
  const lines = text.split("\n").filter(l => l.trim() && !l.trim().startsWith(";") && !l.trim().startsWith("#"));
  if (lines.length < 2) return false;

  // INI: [section] o key=value o key: value
  const sectionPattern = /^\[.+\]/;
  const kvPattern      = /^[a-zA-Z_][a-zA-Z0-9_.\-\s]*[=:]\s*.+/;

  const iniLines = lines.filter(l => sectionPattern.test(l.trim()) || kvPattern.test(l.trim()));
  return iniLines.length >= Math.ceil(lines.length * 0.5);
}

// ─── Definición de tipos conocidos ───────────────────────────────────────────

const TYPES: Record<string, DetectedType> = {
  sql: {
    label:    "SQL Script",
    filename: "stored-procedure.sql",
    icon:     "🗄️",
    color:    "#f59e0b",
  },
  xml: {
    label:    "XML / Config",
    filename: "web.config",
    icon:     "📋",
    color:    "#3b82f6",
  },
  json: {
    label:    "JSON",
    filename: "appsettings.json",
    icon:     "📦",
    color:    "#8b5cf6",
  },
  yaml: {
    label:    "YAML",
    filename: "config.yml",
    icon:     "⚙️",
    color:    "#06b6d4",
  },
  env: {
    label:    "Variables de entorno",
    filename: ".env",
    icon:     "🔐",
    color:    "#10b981",
  },
  ini: {
    label:    "INI / Properties",
    filename: "config.properties",
    icon:     "🔧",
    color:    "#64748b",
  },
  txt: {
    label:    "Texto plano",
    filename: "documento.txt",
    icon:     "📄",
    color:    "#94a3b8",
  },
  unknown: {
    label:    "Desconocido",
    filename: "archivo",
    icon:     "❓",
    color:    "#475569",
  },
};
