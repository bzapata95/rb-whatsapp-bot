/**
 * Extrae uno o varios precios (y opcionalmente nombre) del texto.
 * Acepta: "76 mochila", "Lonchera 27.99", $50, 50 USD, S/ 20, etc.
 * Si hay varias líneas con precios, devuelve todos.
 */

const PATRONES_PRECIO = [
  { regex: /S\/?\s*(\d+(?:[.,]\d+)?)/i, enSoles: true },
  { regex: /\$\s*(\d+(?:[.,]\d+)?)/, enSoles: false },
  { regex: /(\d+(?:[.,]\d+)?)\s*(?:USD|usd|dólares|dolares)/i, enSoles: false },
  { regex: /(?:USD|usd)\s*(\d+(?:[.,]\d+)?)/i, enSoles: false },
  { regex: /precio\s*:?\s*(\d+(?:[.,]\d+)?)/i, enSoles: false },
  { regex: /(\d+(?:[.,]\d{1,2})?)\s*(?:\.|$)/, enSoles: false },
];

function aNumero(str) {
  if (typeof str !== 'string') return NaN;
  const n = parseFloat(str.replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Extrae un precio (y opcional nombre) de una sola línea.
 * Formatos: "76 mochila", "Lonchera 27.99", "$50", "27.99"
 */
function extraerDeLinea(linea) {
  const l = linea.trim();
  if (!l) return null;

  // Número al inicio + nombre: "76 mochila", "76.50 mochila"
  const numeroPrimero = l.match(/^\s*(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (numeroPrimero) {
    const valor = aNumero(numeroPrimero[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      const nombre = numeroPrimero[2].trim().slice(0, 80);
      return { precio: valor, enSoles: false, nombre };
    }
  }

  // Nombre + número al final: "Lonchera 27.99", "Mochila 76"
  const numeroAlFinal = l.match(/^\s*(.+?)\s+(\d+(?:[.,]\d+)?)\s*$/);
  if (numeroAlFinal) {
    const valor = aNumero(numeroAlFinal[2]);
    if (!Number.isNaN(valor) && valor > 0) {
      const nombre = numeroAlFinal[1].trim().slice(0, 80);
      return { precio: valor, enSoles: false, nombre };
    }
  }

  // S/ al inicio
  const soles = l.match(/^S\/?\s*(\d+(?:[.,]\d+)?)/i);
  if (soles) {
    const valor = aNumero(soles[1]);
    if (!Number.isNaN(valor) && valor > 0) return { precio: valor, enSoles: true, nombre: undefined };
  }

  // Resto de patrones ($50, 50 USD, etc.)
  for (const { regex, enSoles } of PATRONES_PRECIO) {
    const m = l.match(regex);
    if (!m) continue;
    const valor = aNumero(m[1]);
    if (Number.isNaN(valor) || valor <= 0) continue;
    return { precio: valor, enSoles, nombre: undefined };
  }

  return null;
}

/**
 * Extrae todos los precios del mensaje.
 * Varias líneas = varios productos. También "precio1 nombre1 / nombre2 precio2" en una línea.
 * @param {string} texto - Cuerpo del mensaje
 * @returns {{ precio: number, enSoles: boolean, nombre?: string }[]}
 */
export function extraerPrecios(texto) {
  if (!texto || typeof texto !== 'string') return [];

  const lineas = texto.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const resultados = [];

  for (const linea of lineas) {
    // Dos precios en la misma línea separados por " / ": "78 color entero / metálico 84"
    if (linea.includes(' / ')) {
      const partes = linea.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
      for (const parte of partes) {
        const r = extraerDeLinea(parte);
        if (r) resultados.push(r);
      }
    } else {
      const r = extraerDeLinea(linea);
      if (r) resultados.push(r);
    }
  }

  // Si no encontramos por líneas, intentar todo el texto como un solo bloque (un solo precio)
  if (resultados.length === 0) {
    const r = extraerDeLinea(texto.trim());
    if (r) resultados.push(r);
  }

  return resultados;
}

/**
 * @param {string} texto - Cuerpo del mensaje
 * @returns {{ precio: number, enSoles: boolean, nombre?: string } | null}
 */
export function extraerPrecio(texto) {
  const arr = extraerPrecios(texto);
  return arr.length > 0 ? arr[0] : null;
}

export default extraerPrecio;
