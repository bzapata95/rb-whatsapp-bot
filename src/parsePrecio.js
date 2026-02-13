/**
 * Extrae uno o varios precios (y opcionalmente nombre) del texto.
 * 
 * FORMATOS SOPORTADOS:
 * - Con nombre: "76 mochila", "Mochila 76", "Pijamas 19", "Medias 3.5"
 * - Con signo $: "$50", "28$", "$28 mochila", "4 pares 8$"
 * - Múltiples en una línea: "16 y 18", "5.5 y 7 (taper)"
 * - Separados por /: "78 color entero / metálico 84"
 * - Complejos: "Tomatodo 6 (plástico) mochila 18"
 * - En soles: "S/ 20", "S/50"
 * - Con USD: "50 USD", "USD 50"
 * - Decimales: "27.99", "3.5", "5.5"
 * 
 * IMPORTANTE: Si el precio tiene signo $ explícito ($28 o 28$), marca conSignoDolar=true
 * para aplicar solo conversión directa (sin fórmula de costos/márgenes).
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

/** Rango típico de tallas: calzado US 3-15, laptops 11/13/15". Números .5 son comunes en tallas. */
const TALLA_MIN = 2;
const TALLA_MAX = 15;

/**
 * Indica si un número parece talla (calzado, ropa, laptop) y no precio.
 * - Tallas: 4, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 11, 12, 13
 * - Precios: 29.99, 39.99 (2 decimales) o valores altos
 */
function pareceTalla(valor, tieneDosDecimales, otrosNumerosEnLinea) {
  if (valor < TALLA_MIN || valor > TALLA_MAX) return false;
  // Si tiene 2 decimales (ej. 21.99) no es talla
  if (tieneDosDecimales) return false;
  // Si es entero o solo .5 (6, 6.5, 7, 7.5, 8.5) puede ser talla
  const esEntero = Number.isInteger(valor);
  const esMedio = Math.abs(valor - Math.floor(valor) - 0.5) < 0.01;
  if (!esEntero && !esMedio) return false;
  // Si en la misma línea hay otro número que sí parece precio (ej. 21.99), este es talla
  if (otrosNumerosEnLinea && otrosNumerosEnLinea.some((n) => n !== valor && (Number.isInteger(n) ? n > 20 : n > 15 || /\.\d{2}$/.test(String(n))))) return true;
  return false;
}

/** True si el número tiene formato de precio (ej. 29.99, 39.99) o es claramente precio (>20). */
function parecePrecio(valor, strNumero) {
  if (valor > 20) return true;
  // Dos decimales típicos de precio
  if (/\.\d{2}$/.test(String(strNumero).replace(',', '.'))) return true;
  if (valor > 15) return true;
  return false;
}

/**
 * Extrae MÚLTIPLES precios de una línea que puede contener varios productos/precios.
 * Intenta capturar el nombre/contexto de cada producto.
 * Casos: "Tomatodo 6 (plástico) mochila 18", "Set 12 y bowl 8"
 * @returns {{ precio: number, enSoles: boolean, conSignoDolar: boolean, nombre?: string }[]}
 */
function extraerMultiplesDePreciosDeLinea(linea) {
  const l = linea.trim();
  if (!l) return [];

  const resultados = [];
  const tieneSignoDolar = /\$/.test(l);

  // Buscar todos los precios con $ explícito: "$28", "8$", etc.
  const patronesDolar = [
    /\$\s*(\d+(?:[.,]\d+)?)/g,  // $28
    /(\d+(?:[.,]\d+)?)\$/g,      // 28$
  ];

  for (const patron of patronesDolar) {
    let match;
    while ((match = patron.exec(l)) !== null) {
      const valor = aNumero(match[1]);
      if (!Number.isNaN(valor) && valor > 0) {
        resultados.push({ precio: valor, enSoles: false, conSignoDolar: true, nombre: undefined });
      }
    }
  }

  // Si encontramos precios con $, retornamos solo esos
  if (resultados.length > 0) return resultados;

  // Buscar precios con "S/" (con barra, no la "s" de "us 6")
  const patronSoles = /(?:^|\s)S\/\s*(\d+(?:[.,]\d+)?)/gi;
  let matchSoles;
  while ((matchSoles = patronSoles.exec(l)) !== null) {
    const valor = aNumero(matchSoles[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      resultados.push({ precio: valor, enSoles: true, conSignoDolar: false, nombre: undefined });
    }
  }

  if (resultados.length > 0) return resultados;

  // Si la línea tiene precio tipo XX.XX y también números que pueden ser tallas (ej. "39.99 us 6"), devolver solo el precio
  const preciosConFormato = l.match(/\d+[.,]\d{2}\b/g);
  if (preciosConFormato && preciosConFormato.length > 0) {
    const soloTallas = l.replace(/\d+[.,]\d{2}\b/g, '').match(/\b\d+(?:[.,]\d+)?\b/g);
    const hayPosiblesTallas = soloTallas && soloTallas.some((s) => { const v = aNumero(s); return v >= TALLA_MIN && v <= TALLA_MAX; });
    if (hayPosiblesTallas) {
      return preciosConFormato
        .map((m) => aNumero(m.replace(',', '.')))
        .filter((n) => !Number.isNaN(n) && n > 0)
        .map((p) => ({ precio: p, enSoles: false, conSignoDolar: false, nombre: undefined }));
    }
  }

  // Buscar patrones: palabra(s) + número
  // Ejemplo: "Tomatodo 6 (plástico) mochila 18"
  // Excluir: "us 6", "laptop de 13" cuando 6 y 13 son tallas
  const patronPalabraPrecio = /([A-Za-zÁ-ÿ]+(?:\s+[A-Za-zÁ-ÿ]+)*?)\s+(\d+(?:[.,]\d+)?)/g;
  let matchPalabra;
  const preciosConNombre = [];
  const todosLosNumerosEnLinea = (l.match(/\d+(?:[.,]\d+)?/g) || []).map((s) => aNumero(s)).filter((n) => !Number.isNaN(n));
  const tienePrecioClaroEnLinea = todosLosNumerosEnLinea.some((v) => v > 20 || (String(v).includes('.') && /\.\d{2}$/.test(String(v))));
  const contextoEsTalla = /\b(us|talla|tallas|mujer|hombre|new balance|entra laptop|laptop\s+de|compartimientos?)\b/i.test(l);

  while ((matchPalabra = patronPalabraPrecio.exec(l)) !== null) {
    const nombre = matchPalabra[1].trim();
    const valor = aNumero(matchPalabra[2]);
    const raw = matchPalabra[2];

    if (!Number.isNaN(valor) && valor > 0) {
      const esCantidad = /^(pares?|unidades?|pcs?|piezas?|set|pack)$/i.test(nombre);
      if (esCantidad) continue;

      // Si hay otro número que es claramente precio (ej. 39.99) y este parece talla (ej. 6), omitir
      const tieneDosDec = /\.\d{2}$/.test(String(raw).replace(',', '.'));
      if (tienePrecioClaroEnLinea && contextoEsTalla && pareceTalla(valor, tieneDosDec, todosLosNumerosEnLinea)) continue;
      if (tienePrecioClaroEnLinea && !parecePrecio(valor, raw) && valor >= TALLA_MIN && valor <= TALLA_MAX && (Number.isInteger(valor) || Math.abs(valor % 1 - 0.5) < 0.01)) continue;

      preciosConNombre.push({
        precio: valor,
        enSoles: false,
        conSignoDolar: false,
        nombre: nombre.slice(0, 80)
      });
    }
  }

  // Quitar de preciosConNombre cualquier valor que sea talla cuando hay otro número que es precio claro
  let preciosFinal = preciosConNombre;
  if (todosLosNumerosEnLinea.length > 1 && tienePrecioClaroEnLinea) {
    preciosFinal = preciosConNombre.filter(
      (item) =>
        !(
          item.precio >= TALLA_MIN &&
          item.precio <= TALLA_MAX &&
          (Number.isInteger(item.precio) || Math.abs((item.precio % 1) - 0.5) < 0.01)
        )
    );
  }

  if (preciosFinal.length > 0) {
    return preciosFinal;
  }

  // Si no encontramos con nombre, buscar todos los números y filtrar tallas
  const patronNumeros = /\b(\d+(?:[.,]\d+)?)\b/g;
  const numerosCandidatos = [];
  let matchNum;

  while ((matchNum = patronNumeros.exec(l)) !== null) {
    const valor = aNumero(matchNum[1]);
    if (Number.isNaN(valor) || valor <= 0) continue;
    const raw = matchNum[1];
    const textoSiguiente = l.substring(matchNum.index + matchNum[0].length, matchNum.index + matchNum[0].length + 15);
    const esCantidad = /^\s*(pares?|unidades?|pcs?|piezas?|compartimientos?)\b/i.test(textoSiguiente);
    if (esCantidad) continue;
    const tieneDosDecimales = /\.\d{2}$/.test(String(raw).replace(',', '.'));
    numerosCandidatos.push({ valor, raw, tieneDosDecimales });
  }

  const valores = numerosCandidatos.map((n) => n.valor);
  const hayPrecioClaro = numerosCandidatos.some((n) => parecePrecio(n.valor, n.raw));
  const tieneContextoTalla = /\b(talla|tallas|us\s+\d|mujer|hombre|new balance|entra laptop|laptop\s+de)\b/i.test(l) ||
    /,\s*\d+[\d.,\s]*$/.test(l); // ej. "49.99 8.5, 9.5, 11"
  const preciosConDosDecimales = numerosCandidatos.filter((n) => /\.\d{2}$/.test(String(n.raw).replace(',', '.')));
  const hayPrecioConDosDecimales = preciosConDosDecimales.length > 0;

  for (const { valor, raw, tieneDosDecimales } of numerosCandidatos) {
    if (tieneDosDecimales) {
      resultados.push({ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined });
      continue;
    }
    if (hayPrecioConDosDecimales && valor >= TALLA_MIN && valor <= TALLA_MAX && (Number.isInteger(valor) || Math.abs((valor % 1) - 0.5) < 0.01)) continue;
    if (hayPrecioClaro && tieneContextoTalla && pareceTalla(valor, tieneDosDecimales, valores)) continue;
    if (hayPrecioClaro && !parecePrecio(valor, raw) && pareceTalla(valor, tieneDosDecimales, valores)) continue;
    resultados.push({ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined });
  }

  // Si en la línea hay precios con 2 decimales (ej. 39.99) y no están en resultados, añadirlos (evita perder el precio cuando solo se capturó talla)
  if (preciosConDosDecimales.length > 0) {
    for (const n of preciosConDosDecimales) {
      if (!resultados.some((r) => r.precio === n.valor)) {
        resultados.unshift({ precio: n.valor, enSoles: false, conSignoDolar: false, nombre: undefined });
      }
    }
    const sinTallas = resultados.filter(
      (r) =>
        !(
          r.precio >= TALLA_MIN &&
          r.precio <= TALLA_MAX &&
          (Number.isInteger(r.precio) || Math.abs((r.precio % 1) - 0.5) < 0.01)
        )
    );
    return sinTallas;
  }

  // Resguardo: si la línea tiene un número tipo precio (XX.XX) y resultados solo tiene tallas, extraer ese precio
  const preciosEstiloLinea = l.match(/\d+[.,]\d{2}\b/g);
  if (preciosEstiloLinea && preciosEstiloLinea.length > 0 && resultados.length > 0 && resultados.every((r) => r.precio >= TALLA_MIN && r.precio <= TALLA_MAX)) {
    return preciosEstiloLinea.map((m) => aNumero(m.replace(',', '.'))).filter((n) => !Number.isNaN(n) && n > 0).map((p) => ({ precio: p, enSoles: false, conSignoDolar: false, nombre: undefined }));
  }

  return resultados;
}

/**
 * Extrae un precio (y opcional nombre) de una sola línea.
 * Formatos: "76 mochila", "Lonchera 27.99", "$50", "28$ entra laptop", "Pijamas 19"
 * @returns {{ precio: number, enSoles: boolean, conSignoDolar: boolean, nombre?: string } | null}
 */
function extraerDeLinea(linea) {
  const l = linea.trim();
  if (!l) return null;

  // Detectar si tiene signo $ explícito (para solo aplicar tipo de cambio, sin fórmula)
  const tieneSignoDolar = /\$/.test(l);

  // Formatos con $ explícito: "$50 mochila", "28$ entra laptop", "$28"
  // Patrón: $número + opcional(espacio + nombre)
  const dolarAntes = l.match(/^\$\s*(\d+(?:[.,]\d+)?)(?:\s+(.+))?$/);
  if (dolarAntes) {
    const valor = aNumero(dolarAntes[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      const nombre = dolarAntes[2]?.trim().slice(0, 80);
      return { precio: valor, enSoles: false, conSignoDolar: true, nombre };
    }
  }

  // Patrón: texto + número+$: "4 pares 8$", "entra laptop 28$"
  // Patrón: número+$ + opcional texto después: "28$", "28$ entra laptop"
  const dolarDespues = l.match(/^(.+?\s+)?(\d+(?:[.,]\d+)?)\$(?:\s+(.+))?$/);
  if (dolarDespues) {
    const valor = aNumero(dolarDespues[2]);
    if (!Number.isNaN(valor) && valor > 0) {
      // Texto antes o después del precio
      const textoAntes = dolarDespues[1]?.trim();
      const textoDespues = dolarDespues[3]?.trim();
      const nombre = (textoAntes || textoDespues)?.slice(0, 80);
      return { precio: valor, enSoles: false, conSignoDolar: true, nombre };
    }
  }

  // S/ al inicio PRIMERO (antes de "nombre + número" para no confundir "S/" con nombre): "S/ 50", "S/50"
  const soles = l.match(/^S\/\s*(\d+(?:[.,]\d+)?)/i);
  if (soles) {
    const valor = aNumero(soles[1]);
    if (!Number.isNaN(valor) && valor > 0) return { precio: valor, enSoles: true, conSignoDolar: false, nombre: undefined };
  }

  // Número al inicio + nombre (sin $): "76 mochila", "19 pijamas", "6 tomatodo"
  const numeroPrimero = l.match(/^\s*(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (numeroPrimero) {
    const valor = aNumero(numeroPrimero[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      const nombre = numeroPrimero[2].trim().slice(0, 80);
      return { precio: valor, enSoles: false, conSignoDolar: false, nombre };
    }
  }

  // Nombre + número al final (sin $): "Lonchera 27.99", "Pijamas 19", "Medias 3.5"
  const numeroAlFinal = l.match(/^\s*(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:\(.*\))?$/);
  if (numeroAlFinal) {
    const valor = aNumero(numeroAlFinal[2]);
    if (!Number.isNaN(valor) && valor > 0) {
      const nombre = numeroAlFinal[1].trim().slice(0, 80);
      return { precio: valor, enSoles: false, conSignoDolar: false, nombre };
    }
  }

  // Solo número: "19", "3.5" (sin contexto adicional)
  const soloNumero = l.match(/^\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (soloNumero) {
    const valor = aNumero(soloNumero[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      return { precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined };
    }
  }

  // Resto de patrones (USD, "precio:", etc.) — nunca marcar enSoles aquí (solo con S/ arriba)
  for (const { regex, enSoles } of PATRONES_PRECIO) {
    const m = l.match(regex);
    if (!m) continue;
    const valor = aNumero(m[1]);
    if (Number.isNaN(valor) || valor <= 0) continue;
    const esPatronDolar = regex.source.includes('\\$');
    const esPatronSoles = regex.source.includes('S');
    const enSolesReal = esPatronSoles && m[0] ? /s\/?\s*/i.test(m[0]) : enSoles;
    return { precio: valor, enSoles: enSolesReal, conSignoDolar: esPatronDolar, nombre: undefined };
  }

  return null;
}

/**
 * Extrae todos los precios del mensaje.
 * Maneja múltiples casos:
 * - Varias líneas: cada línea es un producto
 * - Separador " / ": "78 color entero / metálico 84"
 * - Separador " y ": "16 y 18", "5.5 y 7 (taper)"
 * - Múltiples productos en una línea: "Tomatodo 6 (plástico) mochila 18"
 * @param {string} texto - Cuerpo del mensaje
 * @returns {{ precio: number, enSoles: boolean, conSignoDolar: boolean, nombre?: string }[]}
 */
export function extraerPrecios(texto) {
  if (!texto || typeof texto !== 'string') return [];

  const lineas = texto.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const resultados = [];

  for (const linea of lineas) {
    // Caso 1: Separador " y " con nombres: "Tomatodo 5.5 y bowl 7", "Set 16 y plato 18"
    const patronYConNombres = /^([A-Za-zÁ-ÿ]+(?:\s+[A-Za-zÁ-ÿ]+)*?)\s+(\d+(?:[.,]\d+)?)\s+y\s+([A-Za-zÁ-ÿ]+(?:\s+[A-Za-zÁ-ÿ]+)*?)\s+(\d+(?:[.,]\d+)?)(?:\s+(.+))?$/i;
    const matchYNombres = linea.match(patronYConNombres);
    if (matchYNombres) {
      const nombre1 = matchYNombres[1]?.trim();
      const valor1 = aNumero(matchYNombres[2]);
      const nombre2 = matchYNombres[3]?.trim();
      const valor2 = aNumero(matchYNombres[4]);
      const textoExtra = matchYNombres[5]?.trim();
      
      if (!Number.isNaN(valor1) && valor1 > 0) {
        resultados.push({ precio: valor1, enSoles: false, conSignoDolar: false, nombre: nombre1?.slice(0, 80) });
      }
      if (!Number.isNaN(valor2) && valor2 > 0) {
        resultados.push({ precio: valor2, enSoles: false, conSignoDolar: false, nombre: nombre2?.slice(0, 80) });
      }
      continue;
    }

    // Caso 2: Separador " y " sin nombres: "16 y 18", "5.5 y 7 (taper)"
    const patronY = /^(\d+(?:[.,]\d+)?)\s+y\s+(\d+(?:[.,]\d+)?)(?:\s+(.+))?$/i;
    const matchY = linea.match(patronY);
    if (matchY) {
      const valor1 = aNumero(matchY[1]);
      const valor2 = aNumero(matchY[2]);
      const textoAdicional = matchY[3]?.trim();
      
      if (!Number.isNaN(valor1) && valor1 > 0) {
        resultados.push({ precio: valor1, enSoles: false, conSignoDolar: false, nombre: textoAdicional });
      }
      if (!Number.isNaN(valor2) && valor2 > 0) {
        resultados.push({ precio: valor2, enSoles: false, conSignoDolar: false, nombre: textoAdicional });
      }
      continue;
    }

    // Caso 3: Separador " / ": "78 color entero / metálico 84"
    if (linea.includes(' / ')) {
      const partes = linea.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
      for (const parte of partes) {
        const r = extraerDeLinea(parte);
        if (r) resultados.push(r);
      }
      continue;
    }

    // Caso 4: Línea compleja con múltiples productos: "Tomatodo 6 (plástico) mochila 18"
    // Si tiene múltiples palabras + múltiples números, intentar extraer todos con nombres
    const cantidadNumeros = (linea.match(/\d+(?:[.,]\d+)?/g) || []).length;
    if (cantidadNumeros > 1) {
      const multiples = extraerMultiplesDePreciosDeLinea(linea);
      if (multiples.length > 0) {
        resultados.push(...multiples);
        continue;
      }
    }

    // Caso 5: Línea normal: "76 mochila", "Pijamas 19", "Medias 3.5 (1 par)"
    const r = extraerDeLinea(linea);
    if (r) resultados.push(r);
  }

  // Si no encontramos por líneas, intentar todo el texto como un solo bloque
  if (resultados.length === 0) {
    const r = extraerDeLinea(texto.trim());
    if (r) resultados.push(r);
  }

  // El grupo origen solo envía USD: no marcar soles salvo que el texto tenga "S/" explícito (con barra)
  const tieneSolesExplicito = /s\/\s*\d/i.test(texto);
  if (!tieneSolesExplicito) {
    for (const item of resultados) {
      item.enSoles = false;
    }
  }

  return resultados;
}

/**
 * @param {string} texto - Cuerpo del mensaje
 * @returns {{ precio: number, enSoles: boolean, conSignoDolar: boolean, nombre?: string } | null}
 */
export function extraerPrecio(texto) {
  const arr = extraerPrecios(texto);
  return arr.length > 0 ? arr[0] : null;
}

export default extraerPrecio;
