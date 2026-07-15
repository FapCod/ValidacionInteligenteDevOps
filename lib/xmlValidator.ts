// lib/xmlValidator.ts
// Validador determinista de sintaxis XML en JS puro.
// Detecta etiquetas mal formadas, sin cerrar, y cruces de tags en tiempo récord.

export interface XmlValidationResult {
  valido: boolean;
  error?: string;
}

/**
 * Valida si un texto es un documento XML bien formado.
 * Retorna true o el error de sintaxis detallado con número de línea.
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
        error: `Error en línea ${lineNum}: Etiqueta XML abierta sin cerrar al final del archivo.`,
      };
    }

    const tagContent = xmlText.slice(nextOpen + 1, nextClose);
    pos = nextClose + 1;

    // Ignorar comentarios XML <!-- ... -->
    if (tagContent.startsWith("!--")) {
      // Si el comentario no termina correctamente antes del cierre de este tag, buscar su verdadero final
      if (!tagContent.endsWith("--")) {
        const commentClose = xmlText.indexOf("-->", nextOpen);
        if (commentClose === -1) {
          const lineNum = xmlText.substring(0, nextOpen).split("\n").length;
          return { valido: false, error: `Error en línea ${lineNum}: Comentario XML sin cerrar.` };
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
          error: lastOpen
            ? `Error en línea ${lineNum}: Se esperaba cerrar la etiqueta </${lastOpen}> pero se encontró </${tagName}>.`
            : `Error en línea ${lineNum}: Se encontró una etiqueta de cierre </${tagName}> sin una etiqueta de apertura correspondiente.`,
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
      const lineNum = xmlText.substring(0, nextOpen).split("\n").length;
      return {
        valido: false,
        error: `Error de sintaxis en línea ${lineNum}: Etiqueta mal formada o etiqueta sin cerrar con '/>' o '>'.`,
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
        error: `Error en línea ${lineNum}: Nombre de etiqueta XML inválido o mal formado.`,
      };
    }

    stack.push(tagName);
  }

  if (stack.length > 0) {
    return {
      valido: false,
      error: `Error de estructura: La etiqueta <${stack[stack.length - 1]}> quedó abierta y no se cerró al final del documento.`,
    };
  }

  return { valido: true };
}
