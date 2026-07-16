// lib/xmlValidator.ts
// Validador determinista de sintaxis XML en JS puro.
// Detecta etiquetas mal formadas, sin cerrar, y cruces de tags en tiempo récord.

export interface XmlValidationResult {
  valido: boolean;
  error?: string;
  linea?: number;
  tipo?: "sin_cerrar" | "cruzado" | "invalido" | "abierto_final";
  tagMalo?: string;
  nombreTag?: string;
}

/**
 * Valida si un texto es un documento XML bien formado.
 * Retorna true o el error de sintaxis enriquecido para generar reportes estructurados.
 */
export function validarXml(xmlText: string): XmlValidationResult {
  let pos = 0;
  const len = xmlText.length;
  const stack: string[] = [];

  while (pos < len) {
    const nextOpen = xmlText.indexOf("<", pos);
    if (nextOpen === -1) break;

    // Buscar el cierre del tag ">"
    const nextClose = xmlText.indexOf(">", nextOpen);
    if (nextClose === -1) {
      const lineNum = xmlText.substring(0, nextOpen).split("\n").length;
      return {
        valido: false,
        tipo: "abierto_final",
        linea: lineNum,
        error: `Error en línea ${lineNum}: Etiqueta XML abierta sin cerrar al final del archivo.`,
      };
    }

    const tagContent = xmlText.slice(nextOpen + 1, nextClose);
    pos = nextClose + 1;

    // Ignorar comentarios XML <!-- ... -->
    if (tagContent.startsWith("!--")) {
      if (!tagContent.endsWith("--")) {
        const commentClose = xmlText.indexOf("-->", nextOpen);
        if (commentClose === -1) {
          const lineNum = xmlText.substring(0, nextOpen).split("\n").length;
          return {
            valido: false,
            tipo: "abierto_final",
            linea: lineNum,
            error: `Error en línea ${lineNum}: Comentario XML sin cerrar.`,
          };
        }
        pos = commentClose + 3;
      }
      continue;
    }

    // Ignorar declaraciones <?xml ... ?> o directivas <!DOCTYPE ... >
    if (tagContent.startsWith("?") || tagContent.startsWith("!")) {
      continue;
    }

    // Etiqueta de cierre: </tag>
    if (tagContent.startsWith("/")) {
      const tagName = tagContent.slice(1).trim();
      const lastOpen = stack.pop();
      if (lastOpen !== tagName) {
        const lineNum = xmlText.substring(0, nextOpen).split("\n").length;
        return {
          valido: false,
          tipo: "cruzado",
          linea: lineNum,
          nombreTag: tagName,
          error: lastOpen
            ? `Se esperaba cerrar la etiqueta </${lastOpen}> pero se encontró </${tagName}>.`
            : `Se encontró una etiqueta de cierre </${tagName}> sin una etiqueta de apertura correspondiente.`,
        };
      }
      continue;
    }

    // Etiqueta autoconclusiva: <tag /> o <tag  attr="val" />
    if (tagContent.endsWith("/")) {
      continue;
    }

    // Si el contenido del tag contiene un "<" interno, significa que la etiqueta anterior
    // nunca se cerró con ">" y el parser saltó directamente al inicio de la siguiente.
    if (tagContent.includes("<")) {
      // Buscar el inicio real de la etiqueta que no se cerró (el "<" anterior a nextOpen)
      const startIdx = xmlText.lastIndexOf("<", nextOpen - 1);
      if (startIdx !== -1) {
        const lines = xmlText.substring(0, startIdx).split("\n");
        const lineNum = lines.length;
        
        // Obtener el contenido completo de la línea donde comenzó el tag roto
        const endLineIdx = xmlText.indexOf("\n", startIdx);
        const badLineContent = xmlText.slice(
          startIdx, 
          endLineIdx === -1 ? xmlText.length : endLineIdx
        ).trim();

        return {
          valido: false,
          tipo: "sin_cerrar",
          linea: lineNum,
          tagMalo: badLineContent,
          error: `Etiqueta mal formada o etiqueta sin cerrar con '/>' o '>'.`,
        };
      }

      // Fallback si no encuentra el inicio
      const lineNum = xmlText.substring(0, nextOpen).split("\n").length;
      return {
        valido: false,
        tipo: "sin_cerrar",
        linea: lineNum,
        tagMalo: tagContent.trim(),
        error: `Etiqueta mal formada o etiqueta sin cerrar con '/>' o '>'.`,
      };
    }

    // Extraer el nombre de la etiqueta (primer token antes del espacio)
    const trimmedContent = tagContent.trim();
    const spaceIdx = trimmedContent.indexOf(" ");
    const tagName = spaceIdx === -1 ? trimmedContent : trimmedContent.slice(0, spaceIdx);

    // Asegurarse de que el nombre del tag sea válido y no esté vacío
    if (!tagName || !/^[a-zA-Z0-9.\-_\:]+$/.test(tagName)) {
      const lineNum = xmlText.substring(0, nextOpen).split("\n").length;
      return {
        valido: false,
        tipo: "invalido",
        linea: lineNum,
        error: `Nombre de etiqueta XML inválido o mal formado.`,
      };
    }

    stack.push(tagName);
  }

  if (stack.length > 0) {
    return {
      valido: false,
      tipo: "abierto_final",
      nombreTag: stack[stack.length - 1],
      error: `La etiqueta <${stack[stack.length - 1]}> quedó abierta y no se cerró al final del documento.`,
    };
  }

  return { valido: true };
}
