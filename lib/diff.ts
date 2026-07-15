// lib/diff.ts
// Utilidad para generar diff línea a línea entre dos textos

import { diffLines } from "diff";
import type { DiffLine } from "@/types";

/**
 * Genera un array de DiffLine comparando texto antiguo vs nuevo.
 * Cada línea tiene su tipo (equal, added, removed) y número de línea.
 */
export function computeDiff(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText, newText);
  const result: DiffLine[] = [];

  let lineOld = 1;
  let lineNew = 1;

  for (const change of changes) {
    const lines = change.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();

    for (const line of lines) {
      if (change.added) {
        result.push({ type: "added",   content: line, lineOld: null,     lineNew: lineNew++ });
      } else if (change.removed) {
        result.push({ type: "removed", content: line, lineOld: lineOld++, lineNew: null });
      } else {
        result.push({ type: "equal",   content: line, lineOld: lineOld++, lineNew: lineNew++ });
      }
    }
  }

  return result;
}

// ─── Side-by-Side Diff ──────────────────────────────────────────────────────

export interface SideBySideRow {
  left: {
    lineNum: number | null;
    content: string;
    type: "equal" | "removed" | "empty";
  };
  right: {
    lineNum: number | null;
    content: string;
    type: "equal" | "added" | "empty";
  };
}

/**
 * Convierte el diff lineal en filas side-by-side (izquierda vs derecha).
 * - Líneas iguales  → aparecen en AMBOS lados
 * - Líneas eliminadas → solo IZQUIERDA; el lado derecho queda vacío
 * - Líneas agregadas  → solo DERECHA; el lado izquierdo queda vacío
 * - Bloques adyacentes removed+added → se emparejan en la misma fila
 */
export function computeSideBySideDiff(
  oldText: string,
  newText: string
): SideBySideRow[] {
  const lines = computeDiff(oldText, newText);
  const rows: SideBySideRow[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.type === "equal") {
      rows.push({
        left:  { lineNum: line.lineOld, content: line.content, type: "equal" },
        right: { lineNum: line.lineNew, content: line.content, type: "equal" },
      });
      i++;

    } else if (line.type === "removed") {
      // Si la siguiente línea es "added", emparejarlas en la misma fila
      const next = lines[i + 1];
      if (next && next.type === "added") {
        rows.push({
          left:  { lineNum: line.lineOld, content: line.content,  type: "removed" },
          right: { lineNum: next.lineNew, content: next.content,   type: "added" },
        });
        i += 2;
      } else {
        rows.push({
          left:  { lineNum: line.lineOld, content: line.content, type: "removed" },
          right: { lineNum: null,         content: "",            type: "empty" },
        });
        i++;
      }

    } else {
      // type === "added" sin removed previo
      rows.push({
        left:  { lineNum: null,         content: "",           type: "empty" },
        right: { lineNum: line.lineNew, content: line.content, type: "added" },
      });
      i++;
    }
  }

  return rows;
}

/**
 * Devuelve solo las líneas que cambiaron + N líneas de contexto alrededor.
 * Útil para archivos grandes donde enviar todo el archivo a la IA sería excesivo.
 */
export function computeDiffWithContext(
  oldText: string,
  newText: string,
  contextLines = 3
): DiffLine[] {
  const all = computeDiff(oldText, newText);
  const changedIndices = new Set<number>();

  all.forEach((line, i) => {
    if (line.type !== "equal") {
      for (
        let j = Math.max(0, i - contextLines);
        j <= Math.min(all.length - 1, i + contextLines);
        j++
      ) {
        changedIndices.add(j);
      }
    }
  });

  if (changedIndices.size === 0) return all; // Sin cambios

  return all.filter((_, i) => changedIndices.has(i));
}

