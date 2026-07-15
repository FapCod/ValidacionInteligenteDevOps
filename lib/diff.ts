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
    // diffLines agrega una línea vacía al final del último bloque
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }

    for (const line of lines) {
      if (change.added) {
        result.push({
          type: "added",
          content: line,
          lineOld: null,
          lineNew: lineNew++,
        });
      } else if (change.removed) {
        result.push({
          type: "removed",
          content: line,
          lineOld: lineOld++,
          lineNew: null,
        });
      } else {
        result.push({
          type: "equal",
          content: line,
          lineOld: lineOld++,
          lineNew: lineNew++,
        });
      }
    }
  }

  return result;
}

/**
 * Devuelve solo las líneas que cambiaron + N líneas de contexto alrededor.
 * Útil para archivos grandes donde mostrar todo el diff sería muy extenso.
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

  if (changedIndices.size === 0) return all; // Sin cambios: mostrar todo

  return all.filter((_, i) => changedIndices.has(i));
}
