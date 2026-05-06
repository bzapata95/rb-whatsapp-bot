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
 * - Precio + stock por tallas: "37, solo 1 en 7 y 5.5" (solo 37 es precio; 7 y 5.5 son tallas)
 * - Precio + tallas en misma línea: "16.99 tallas 7,8,11,12,10", "79.99 tallas 7,7.5 y 8"
 * - Precio arriba y debajo sólo tallas: "29.99" + línea "Solo 7.5 y 8" (sin segundo precio ficticio ni alerta ⚠️ "Solo 7")
 * - Precio rebaja: "29.99 precio regular 42.50" (29.99=venta, 42.50=antes; precioRegular opcional)
 * - Tallas primero, precio al final: "7,10,11 24.99" (7,10,11=tallas, 24.99=precio)
 * - Ropa infantil rangos años/talla: segunda línea "8-10", "8-10, 12-14" o "2-3, 4-5, …, 16" (tramo suelto; se muestra la línea tal cual)
 * - Precio y debajo talla US + género: "12.99" luego "7 hombre" → una sola oferta, talla mostrada "7 (Hombre)"
 * - Precio + línea tallas + género: "9.5 y 10 hombre", "9, 9.5 y 10 hombre", "8/9 hombre" → un precio; tallas con (Hombre/Mujer/Niño), no USD por número
 * - Precio + "8.5 KL": talla + sigla marca (2–6 MAYÚSCULAS), no segundo precio con nombre "KL"
 * - Bracieres sostén: "34b, 34c y 36c 24.99" → tallas 34B, 34C, 36C y un precio 24.99 (copa = letras tras el contorno)
 * - Una línea: precio + "hay" + tallas pantalón o calzado: "33.7 hay 39 y 40"
 * - Sólo lista con prefijo "Tallas"/"Talla": "Tallas 38,41,36 y 37"
 * - Precio y línea niña/niño + tallas calzado bebé: "9.99" + "Niña 1, 2 y 3" (1–15 US; incluye talla 1)
 * - Precio y una talla solo en segunda línea: "29.99" + "7.6" (no dos decimales tipo .99 ⇒ talla; no segundo precio)
 * - Pulgadas de laptop/tablet ("laptop 13\"", "12.5 pulgadas") ≠ talla calzado; "tallas 12 y 13" sí son tallas
 * - Foto/caption sólo disponibilidad: "5.5 y 6", "6.5 a 7.5" (sin precio) → tallas/rango, sin USD falsos ni fallback corrupto
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
/** Calzado bebé (línea "Niña 1, 2 y 3"): talla US desde 1. No mezclar con TALLA_MIN global. */
const TALLA_CALZADO_BEBE_MIN = 1;

/** Rango de tallas de pantalón (cintura en pulgadas): 24-42. Usado para detectar "26, 28, 30, 31" debajo del precio. */
const TALLA_PANTALON_MIN = 24;
const TALLA_PANTALON_MAX = 42;

/** Contorno (tiro) típico sostén US; número + copa(s) tipo 34B, 36DD */
const BANDA_BRASIER_MIN = 26;
const BANDA_BRASIER_MAX = 52;

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

  // Caso "9$ 7 pares", "12$ 3 pares": precio$ + cantidad pares → solo el precio
  const matchPrecioPares = l.match(/^(\d+(?:[.,]\d+)?)\$\s+(\d+)\s+(?:pares?|medias?|medías?)\b/i);
  if (matchPrecioPares) {
    const valor = aNumero(matchPrecioPares[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      return [{ precio: valor, enSoles: false, conSignoDolar: true, nombre: undefined }];
    }
  }

  // Caso "9 pack 2 medías", "12.99 pack 2 juicy top": precio + pack + cantidad + producto → solo el precio
  const matchPrecioPack = l.match(/^(\d+(?:[.,]\d+)?)\s+pack\s+\d+\s+(.+)$/i);
  if (matchPrecioPack) {
    const valor = aNumero(matchPrecioPack[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      return [{ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined }];
    }
  }

  // Caso "pack 2 und 12", "Pack 3 und 14.99 us polo m": pack + cantidad + und + precio
  const matchPackUnd = l.match(/^pack\s+\d+\s*(?:und|unidades?)?\s+(.+)$/i);
  if (matchPackUnd) {
    const resto = matchPackUnd[1].trim();
    const precioMatch = resto.match(/^(\d+(?:[.,]\d+)?)\b/);
    if (precioMatch) {
      const valor = aNumero(precioMatch[1]);
      const restoTrasPrecio = resto.slice(precioMatch[0].length).trim();
      const nombre = restoTrasPrecio && /[a-z]/i.test(restoTrasPrecio) ? restoTrasPrecio.replace(/\b(us|m|s|xl|hombre|mujer)\b/gi, '').trim().slice(0, 60) : undefined;
      if (!Number.isNaN(valor) && valor > 0) {
        return [{ precio: valor, enSoles: false, conSignoDolar: false, nombre: nombre || undefined }];
      }
    }
  }

  // Caso "2x47", "2x49 hombre", "3x29.99": cantidad por precio
  const matchCantidadPrecio = l.match(/^(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?:\s+(.+))?$/i);
  if (matchCantidadPrecio) {
    const cantidad = parseInt(matchCantidadPrecio[1], 10);
    const valor = aNumero(matchCantidadPrecio[2]);
    const extra = matchCantidadPrecio[3]?.trim();
    const nombre = /^(hombre|mujer|niño|nino)$/i.test(extra) ? extra : undefined;
    if (cantidad > 0 && !Number.isNaN(valor) && valor > 0) {
      return [{ precio: valor, enSoles: false, conSignoDolar: false, nombre, cantidad }];
    }
  }

  // Caso "16.99 tallas 7,8,11" o "79.99 tallas 7,7.5 y 8": precio + "tallas" + lista (comas, decimales .5, " y ")
  const matchPrecioTallas = l.match(/^(\d+(?:[.,]\d{1,2})?)\s+tallas\s+\S/i);
  if (matchPrecioTallas) {
    const valor = aNumero(matchPrecioTallas[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      return [{ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined }];
    }
  }

  // Caso "Affef 100ml 27.99": marca + capacidad + precio → nombre = marca, precio al final
  const matchMarcaCapacidad = l.match(/^([A-Za-zÁ-ÿ]+)\s+(\d+)\s*(?:ml|oz|onz|g)\s+(\d+(?:[.,]\d{1,2})?)\s*$/i);
  if (matchMarcaCapacidad) {
    const valor = aNumero(matchMarcaCapacidad[3]);
    if (!Number.isNaN(valor) && valor > 0) {
      return [{ precio: valor, enSoles: false, conSignoDolar: false, nombre: matchMarcaCapacidad[1].trim().slice(0, 60) }];
    }
  }

  // Caso "16.99 16 onz", "16.99 30 onz": precio + capacidad + unidad → 1 producto (oz/onz es capacidad)
  const matchPrecioCapacidad = l.match(/^(\d+(?:[.,]\d{1,2})?)\s+(\d+)\s*(?:oz|onz|ml|g|kg|lb)\b/i);
  if (matchPrecioCapacidad) {
    const valor = aNumero(matchPrecioCapacidad[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      return [{ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined }];
    }
  }

  // Caso "30 oz 16.99", "16 onz 16.99" o "30 oz 16.99 40 oz 19.99": cantidad + unidad + precio (uno o varios)
  const matchesCantidadUnidad = l.matchAll(/(\d+)\s*(oz|onz|ml|g|kg|lb)\s+(\d+(?:[.,]\d{1,2})?)/gi);
  const resultadosCantidadUnidad = [];
  for (const m of matchesCantidadUnidad) {
    const nombre = `${m[1]} ${m[2]}`;
    const valor = aNumero(m[3]);
    if (!Number.isNaN(valor) && valor > 0) {
      resultadosCantidadUnidad.push({ precio: valor, enSoles: false, conSignoDolar: false, nombre });
    }
  }
  if (resultadosCantidadUnidad.length > 0) {
    return resultadosCantidadUnidad;
  }

  // Caso "7,10,11 24.99": tallas primero (separadas por coma), precio al final
  const matchTallasPrecio = l.match(/^(\d+(?:,\d+)+)\s+(\d+[.,]\d{1,2})\s*$/);
  if (matchTallasPrecio) {
    const tallasStr = matchTallasPrecio[1];
    const precioStr = matchTallasPrecio[2];
    const tallas = tallasStr.split(',').map((s) => aNumero(s.trim())).filter((n) => !Number.isNaN(n));
    const precio = aNumero(precioStr.replace(',', '.'));
    const todasTallasValidas = tallas.length > 0 && tallas.every(
      (v) => v >= TALLA_MIN && v <= TALLA_MAX && (Number.isInteger(v) || Math.abs((v % 1) - 0.5) < 0.01)
    );
    if (todasTallasValidas && !Number.isNaN(precio) && precio > 0) {
      return [{ precio, enSoles: false, conSignoDolar: false, nombre: undefined }];
    }
  }

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
    const esTallaCm = /^\s*cm\b/i.test(textoSiguiente); // "25.5 cm" → no es precio
    if (esTallaCm) continue;
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

  // Caso "2x47", "2x49 hombre", "3x29.99": cantidad por precio
  const matchCantidadPrecio = l.match(/^(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?:\s+(.+))?$/i);
  if (matchCantidadPrecio) {
    const cantidad = parseInt(matchCantidadPrecio[1], 10);
    const valor = aNumero(matchCantidadPrecio[2]);
    const extra = matchCantidadPrecio[3]?.trim();
    const nombre = /^(hombre|mujer|niño|nino)$/i.test(extra) ? extra : undefined;
    if (cantidad > 0 && !Number.isNaN(valor) && valor > 0) {
      return { precio: valor, enSoles: false, conSignoDolar: false, nombre, cantidad };
    }
  }

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

  // Cantidad + unidad + precio: "30 oz 16.99", "40 oz 19.99" → nombre "30 oz", precio 16.99
  const cantidadUnidadPrecio = l.match(/^(\d+)\s*(oz|ml|g|kg|lb)\s+(\d+(?:[.,]\d{1,2})?)\s*$/i);
  if (cantidadUnidadPrecio) {
    const cantidad = cantidadUnidadPrecio[1];
    const unidad = cantidadUnidadPrecio[2];
    const valor = aNumero(cantidadUnidadPrecio[3]);
    if (!Number.isNaN(valor) && valor > 0) {
      return { precio: valor, enSoles: false, conSignoDolar: false, nombre: `${cantidad} ${unidad}` };
    }
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

  // Nombre + número + opcional talla letra: "Hombre 118 S", "Mujer 49.99 M"
  const nombreNumeroTalla = l.match(/^\s*(.+?)\s+(\d+(?:[.,]\d+)?)\s+(?:[A-Za-z]{1,3})\s*$/);
  if (nombreNumeroTalla) {
    const posibleTalla = nombreNumeroTalla[0].trim().split(/\s+/).pop();
    const esTallaLetra = /^(XXS|XS|S|M|L|XL|XXL|2XL|3XL)$/i.test(posibleTalla);
    if (esTallaLetra) {
      const valor = aNumero(nombreNumeroTalla[2]);
      if (!Number.isNaN(valor) && valor > 0) {
        const nombre = nombreNumeroTalla[1].trim().slice(0, 80);
        return { precio: valor, enSoles: false, conSignoDolar: false, nombre };
      }
    }
  }

  // Número + coma + texto: "450, mujer", "159,99"
  const numeroComaTexto = l.match(/^\s*(\d+(?:[.,]\d+)?)\s*,\s*(.+)$/);
  if (numeroComaTexto) {
    const valor = aNumero(numeroComaTexto[1]);
    const resto = numeroComaTexto[2].trim();
    if (!Number.isNaN(valor) && valor > 0 && resto.length > 0 && !/^\d/.test(resto)) {
      const nombre = resto.slice(0, 80);
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
 * Indica si una línea contiene solo números que parecen tallas (no precios).
 * Usado cuando arriba ya hubo un precio: "34.55" luego "6 7 8.5" → la segunda es tallas.
 * No debe tener nombre de producto (ej. "Monedero 8" tiene nombre → no es solo tallas).
 */
function lineaSoloTallas(linea) {
  const l = linea.trim();
  if (!l) return false;
  if (/\$|S\/\s*\d|precio\s*:?\s*\d|USD\s*\d|\d\s*USD/i.test(l)) return false;
  // Si tiene 2+ letras consecutivas (nombre de producto), no es "solo tallas"
  if (/[A-Za-zÁ-ÿ]{2,}/.test(l)) return false;
  const rawMatches = l.match(/\b(\d+(?:[.,]\d+)?)\b/g) || [];
  if (rawMatches.some((raw) => /\.\d{2}$/.test(String(raw).replace(',', '.')))) return false; // "10.00" es precio
  const numeros = rawMatches.map((s) => aNumero(s)).filter((n) => !Number.isNaN(n));
  if (numeros.length === 0) return false;
  for (const v of numeros) {
    if (v > TALLA_MAX || v < TALLA_MIN) return false;
    if (v > 20) return false;
    if (/\.\d{2}$/.test(String(v))) return false; // dos decimales = precio
    const esMedio = Math.abs((v % 1) - 0.5) < 0.01;
    if (!Number.isInteger(v) && !esMedio) return false;
  }
  return true;
}

/** True si el valor se considera "precio claro" (no talla): >20 o dos decimales (ej. 34.55, 10.00). */
function esPrecioClaro(precio, strNumero) {
  if (precio > 20) return true;
  const str = strNumero !== undefined ? String(strNumero).replace(',', '.') : String(precio);
  if (/\.\d{2}$/.test(str)) return true;
  if (precio > 15) return true;
  return false;
}

/**
 * Indica si una línea contiene solo números que parecen tallas de pantalón (cintura 24-42).
 * Usado cuando arriba hay precio: "32.99" luego "26, 28, 30, 31" → la segunda son tallas, no precios.
 */
function lineaSoloTallasPantalon(linea) {
  const l = linea.trim();
  if (!l) return false;
  if (/\$|S\/\s*\d|precio\s*:?\s*\d|USD\s*\d|\d\s*USD/i.test(l)) return false;
  // "Conjunto 35 y 32" tiene nombre de producto — no es solo tallas
  if (/[A-Za-zÁ-ÿ]{3,}/.test(l)) return false;
  const rawMatches = l.match(/\b(\d+(?:[.,]\d+)?)\b/g) || [];
  if (rawMatches.length === 0) return false;
  const numeros = rawMatches.map((s) => aNumero(s)).filter((n) => !Number.isNaN(n));
  if (numeros.length === 0) return false;
  for (const v of numeros) {
    if (v < TALLA_PANTALON_MIN || v > TALLA_PANTALON_MAX) return false;
    if (/\.\d{2}$/.test(String(v))) return false; // dos decimales = precio (ej. 26.99)
    const esMedio = Math.abs((v % 1) - 0.5) < 0.01;
    if (!Number.isInteger(v) && !esMedio) return false;
  }
  return true;
}

/** True si la línea es solo talla(s) en cm (ej. "25.5 cm" o "25 cm, 26 cm"). No tomar como precio. */
function lineaEsTallaCm(linea) {
  const l = linea.trim();
  if (!l) return false;
  return /^\d+(?:[.,]\d+)?\s*cm(\s*[,y]\s*\d+(?:[.,]\d+)?\s*cm)*\s*$/i.test(l);
}

/**
 * Una sola talla US en la línea: "10", "7.5", "7.6" (tipeo/decim europeo típico bajo precio).
 * No "29.99" (dos decimales = formato precio). Rango incluye calzado bebé hasta TALLA_MAX.
 */
function lineaEsSoloTallaCalzadoUnicaFlexible(linea) {
  const l = linea.trim();
  const m = l.match(/^(\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return false;
  const raw = String(m[1]).replace(',', '.');
  const v = aNumero(raw);
  if (Number.isNaN(v) || v < TALLA_CALZADO_BEBE_MIN || v > TALLA_MAX) return false;
  if (/^\d+\.\d{2}$/.test(raw)) return false;
  return true;
}

function valorLineaUnicaTallaCalzado(linea) {
  if (!lineaEsSoloTallaCalzadoUnicaFlexible(linea)) return null;
  const m = linea.trim().match(/^(\d+(?:[.,]\d+)?)\s*$/);
  return m ? aNumero(m[1].replace(',', '.')) : null;
}

/** True si la línea es talla de bebé primero (ej. "24 M", "24 meses"). No tomar el número como precio. */
function lineaEsTallaBebePrimero(linea) {
  const l = linea.trim();
  if (!l) return false;
  return /^\d{1,2}\s*M\s*$/i.test(l) || /^\d{1,2}\s*meses?\s*$/i.test(l);
}

/** True si la línea describe stock por talla: "solo 1 en 7 y 5.5", "solo 2 en 8". Los números tras "en" son tallas, no precios. */
function lineaEsStockPorTalla(linea) {
  const l = linea.trim();
  return /solo\s+\d+\s+en\s+\d/i.test(l);
}

/** Un token de lista de tallas (calzado o pantalón con /). */
function tokenEsTallaListado(token) {
  const t = token.trim();
  if (!t) return false;
  if (t.includes('/')) {
    const nums = t.split('/').map((x) => aNumero(x.trim()));
    return nums.every(
      (n) =>
        !Number.isNaN(n) &&
        ((n >= TALLA_MIN && n <= TALLA_MAX) || (n >= TALLA_PANTALON_MIN && n <= TALLA_PANTALON_MAX)) &&
        (Number.isInteger(n) || Math.abs((n % 1) - 0.5) < 0.01)
    );
  }
  const n = aNumero(t);
  return (
    !Number.isNaN(n) &&
    ((n >= TALLA_MIN && n <= TALLA_MAX) || (n >= TALLA_PANTALON_MIN && n <= TALLA_PANTALON_MAX)) &&
    (Number.isInteger(n) || Math.abs((n % 1) - 0.5) < 0.01)
  );
}

/**
 * "Solo 7.5 y 8", "Solo 7.5 y" (mensaje cortado), "solo tallas 6 y 9" → lista de disponibilidad por talla, NO precio ni "producto Solo".
 */
function lineaEsSoloListaTallas(linea) {
  const l = linea.trim();
  if (!/^solo\s+/i.test(l)) return false;
  if (lineaEsStockPorTalla(l)) return false;
  if (/^solo\s+\d+\s*(?:unidades?|und|pares?|medias?|stock\b)/i.test(l)) return false;
  let resto = l.replace(/^solo\s+/i, '').trim();
  if (!resto) return false;
  resto = resto.replace(/^tallas?\s+/i, '').trim();
  if (!resto) return false;
  if (!/^[\d\s,.y\/]+$/i.test(resto)) return false;
  const tokens = splitListaTallasTokens(resto);
  if (tokens.length === 0) return false;
  return tokens.every((tok) => tokenEsTallaListado(tok));
}

/** Extrae precio de línea con formato "37, solo 1 en 7 y 5.5" (precio + stock por tallas). Solo devuelve el precio. */
function extraerPrecioDeLineaConStockTallas(linea) {
  const l = linea.trim();
  // "37, solo 1 en 7 y 5.5" o "37 solo 1 en 7 y 5.5" → precio es el primer número
  const match = l.match(/^(\d+(?:[.,]\d+)?)\s*[,.]?\s*solo\s+\d+\s+en\s+/i);
  if (!match) return null;
  const valor = aNumero(match[1]);
  if (Number.isNaN(valor) || valor <= 0) return null;
  return { precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined };
}

/** True si alguna línea del mensaje tiene un número que parece precio claro (XX.XX o >20). */
function algunaLineaTienePrecioClaro(lineas) {
  for (const l of lineas) {
    const nums = (l.match(/\b(\d+(?:[.,]\d+)?)\b/g) || []);
    for (const raw of nums) {
      const v = aNumero(raw);
      if (!Number.isNaN(v) && (v > 20 || /\.\d{2}$/.test(String(raw).replace(',', '.')))) return true;
    }
  }
  return false;
}

/** Entero suelto válido tras rangos años (ej. "…, 16" talla prenda); mismo techo que rango NIÑO. */
const TALLA_EDAD_SUELTA_MAX = 20;

/**
 * True si la línea son solo rangos talla/edad niño(a), separados por comas — y opción suelta "16", etc.
 * Ej. "8-10", "2-4", "8-10, 12-14", "2-3, 4-5, 6-7, 8-10, 16".
 * Hay que tener **al menos un** fragmento tipo N-M para no clasificar líneas solo números (calzado).
 */
function lineaEsRangoTallaEdad(linea) {
  const l = linea.trim();
  if (!l) return false;
  const partes = l.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  if (partes.length === 0) return false;
  let hayRangoNiño = false;
  for (const p of partes) {
    const rg = p.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
    if (rg) {
      const a = aNumero(rg[1]);
      const b = aNumero(rg[2]);
      if (Number.isNaN(a) || Number.isNaN(b) || a > b || a < 0 || b > TALLA_EDAD_SUELTA_MAX) return false;
      hayRangoNiño = true;
      continue;
    }
    const sm = p.match(/^(\d{1,2})\s*$/);
    if (!sm) return false;
    const v = aNumero(sm[1]);
    if (Number.isNaN(v) || v < TALLA_MIN || v > TALLA_EDAD_SUELTA_MAX) return false;
  }
  return hayRangoNiño;
}

/** Número en formato talla US + género (.5 ok; .99 = precio → no). null si no es talla válida. */
function valorNumeroTallaCalzadoParaGenero(raw) {
  const v = aNumero(String(raw));
  if (Number.isNaN(v) || v < TALLA_MIN || v > TALLA_MAX) return null;
  const strN = String(raw).replace(',', '.');
  if (/^\d+\.\d{2}$/.test(strN)) return null;
  const esMedio = Math.abs((v % 1) - 0.5) < 0.01;
  if (!Number.isInteger(v) && !esMedio) return null;
  return v;
}

/**
 * Talla de calzado + género en una sola línea: "7 hombre", "10.5 mujer", "8 niño".
 * Suele ir debajo del precio; no debe leerse como precio USD + nombre del producto.
 */
function lineaEsTallaGeneroCalzado(linea) {
  const l = linea.trim();
  const m = l.match(/^(\d+(?:[.,]\d+)?)\s+(hombre|mujer|ni[ñn]o)\s*$/iu);
  if (!m) return false;
  return valorNumeroTallaCalzadoParaGenero(m[1]) != null;
}

/** Género al final de línea (tallas calzado delante). */
const RE_GENERO_TALLAS_CALZADO_FINAL = /\s+(hombre|mujer|ni[ñn]o)\s*$/iu;

/**
 * "9.5 y 10 hombre", "9, 9.5 y 10 mujer", "8 y 9.5 niño", "9/10 hombre".
 * No cubre una sola talla ("7 hombre" → lineaEsTallaGeneroCalzado).
 */
function matchListaTallasCalzadoConGeneroFinal(linea) {
  const l = linea.trim();
  const mg = l.match(RE_GENERO_TALLAS_CALZADO_FINAL);
  if (!mg) return null;
  const cuerpo = l.slice(0, l.length - mg[0].length).trim();
  const genero = mg[1].toLowerCase();
  if (!cuerpo) return null;
  if (!/^[\d\s,.y\/]+$/iu.test(cuerpo)) return null;
  const tokens = splitListaTallasTokens(cuerpo);
  if (tokens.length === 0) return null;
  const vals = [];
  for (const t of tokens) {
    const s = t.trim();
    if (!s) return null;
    if (s.includes('/')) {
      for (const p of s.split('/')) {
        const v = valorNumeroTallaCalzadoParaGenero(p.trim());
        if (v == null) return null;
        vals.push(v);
      }
      continue;
    }
    const v = valorNumeroTallaCalzadoParaGenero(s);
    if (v == null) return null;
    vals.push(v);
  }
  if (vals.length < 2) return null;
  return { vals, genero };
}

function lineaEsListaTallasCalzadoConGeneroFinal(linea) {
  return matchListaTallasCalzadoConGeneroFinal(linea) != null;
}

function etiquetasListaTallasCalzadoConGeneroFinal(linea) {
  const hit = matchListaTallasCalzadoConGeneroFinal(linea);
  if (!hit) return [];
  const nombre =
    hit.genero === 'mujer' ? 'Mujer' : hit.genero === 'hombre' ? 'Hombre' : 'Niño';
  return hit.vals.map((v) => `${v} (${nombre})`);
}

/** Etiqueta de género para salida (ej. "7 (Hombre)"). */
function etiquetaTallaGenero(linea) {
  const m = linea.trim().match(/^(\d+(?:[.,]\d+)?)\s+(hombre|mujer|ni[ñn]o)\s*$/iu);
  if (!m) return null;
  const v = aNumero(m[1]);
  const g = m[2].toLowerCase();
  const nombre =
    g === 'mujer' ? 'Mujer' : g === 'hombre' ? 'Hombre' : 'Niño';
  return `${v} (${nombre})`;
}

/**
 * "8.5 KL", "10 NB": talla US válida + palabra sólo MAYÚSCULAS 2–6 letras (sigla de marca/línea).
 * Evita numeroPrimero ("8.5" + nombre "KL") cuando debajo del precio es talla + marca.
 */
function lineaEsTallaCalzadoYMarciaSigla(linea) {
  const l = linea.trim();
  const m = l.match(/^(\d+(?:[.,]\d+)?)\s+([A-ZÁÉÍÓÚÑ]{2,6})\s*$/u);
  if (!m) return false;
  if (valorNumeroTallaCalzadoParaGenero(m[1]) == null) return false;
  const sigla = m[2];
  if (/^(US|UK|XS|XL|XX|ML|OZ|CM|MM)$/iu.test(sigla)) return false;
  return true;
}

function etiquetaTallaCalzadoMarciaSigla(linea) {
  const m = linea.trim().match(/^(\d+(?:[.,]\d+)?)\s+([A-ZÁÉÍÓÚÑ]{2,6})\s*$/u);
  if (!m) return null;
  const v = valorNumeroTallaCalzadoParaGenero(m[1]);
  if (v == null) return null;
  const sigla = m[2];
  if (/^(US|UK|XS|XL|XX|ML|OZ|CM|MM)$/iu.test(sigla)) return null;
  return `${v} (${sigla})`;
}

/** Token "34b", "36DD": banda + copa (solo letras A-Z, 1–4). */
function normalizarEtiquetaTallaBrasier(token) {
  const t = token.trim();
  const m = t.match(/^(\d{2,3})([a-zA-Z]{1,4})$/u);
  if (!m) return null;
  const band = parseInt(m[1], 10);
  if (band < BANDA_BRASIER_MIN || band > BANDA_BRASIER_MAX) return null;
  const cup = m[2].toUpperCase();
  if (!/^[A-Z]+$/.test(cup) || cup.length < 1 || cup.length > 4) return null;
  return `${band}${cup}`;
}

/**
 * "34b, 34c y 36c 24.99": lista de tallas sostén y precio XX.XX final (obligatorio dos decimales de precio).
 * @returns {{ precio: number, tallasEtiquetas: string[] } | null}
 */
function parseLineaListaTallasBrasierYPrecioFinal(linea) {
  const l = linea.trim();
  const mPrecio = l.match(/\s+(\d+[.,]\d{2})\s*$/);
  if (!mPrecio) return null;
  const precio = aNumero(mPrecio[1]);
  if (Number.isNaN(precio) || precio <= 0) return null;
  const cuerpo = l.slice(0, l.length - mPrecio[0].length).trim();
  if (!cuerpo) return null;
  if (!/^[\d\s,.ya-z]+$/iu.test(cuerpo.replace(/\s+/g, ' '))) return null;
  const tokens = splitListaTallasTokens(cuerpo);
  if (tokens.length < 1) return null;
  const tallasEtiquetas = [];
  for (const tok of tokens) {
    const et = normalizarEtiquetaTallaBrasier(tok.trim());
    if (!et) return null;
    tallasEtiquetas.push(et);
  }
  return { precio, tallasEtiquetas };
}

/** Extrae tallas de "7,10,11 24.99" — números antes del precio, separados por coma. */
function extraerTallasDeLineaTallasPrimeroPrecioFinal(linea) {
  const m = linea.match(/^(\d+(?:,\d+)+)\s+\d+[.,]\d{1,2}\s*$/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => aNumero(s.trim()))
    .filter((n) => !Number.isNaN(n) && n >= TALLA_MIN && n <= TALLA_MAX && (Number.isInteger(n) || Math.abs((n % 1) - 0.5) < 0.01));
}

/**
 * Lista tras la palabra "tallas": separar por " y " antes que por coma para no juntar "7,7" con "7.5"
 * en un solo token erróneo (bug: "7,7.5" → regex global veía "7,7" + ".5"→5).
 */
function splitListaTallasTokens(parte) {
  if (!parte || typeof parte !== 'string') return [];
  const tokens = [];
  for (const segmentoY of parte.trim().split(/\s+\by\b\s+/i)) {
    for (const segmentoComma of segmentoY.split(/\s*,\s*/)) {
      const t = segmentoComma.trim();
      if (t) tokens.push(t);
    }
  }
  return tokens;
}

/**
 * Lista tras la palabra "hay" cuando el formato es "<precio> hay <tallas>": "33.7 hay 39 y 40".
 * Tallas válidas = cintura pantalón US 24-42 enteros y/o calzado 2-15 (.5 opcional).
 */
function parseListaNumerosTrasHay(listaTxt) {
  const tokens = splitListaTallasTokens(listaTxt.trim());
  if (tokens.length === 0) return null;
  const nums = [];
  for (const t of tokens) {
    const s = t.trim();
    if (s.includes('/')) {
      const partes = s.split('/').map((x) => aNumero(x.trim()));
      if (partes.some((n) => Number.isNaN(n))) return null;
      for (const n of partes) {
        const ok =
          (n >= TALLA_PANTALON_MIN &&
            n <= TALLA_PANTALON_MAX &&
            Number.isInteger(n)) ||
          (n >= TALLA_MIN &&
            n <= TALLA_MAX &&
            (Number.isInteger(n) || Math.abs((n % 1) - 0.5) < 0.01));
        if (!ok) return null;
        nums.push(n);
      }
      continue;
    }
    const n = aNumero(s);
    if (Number.isNaN(n)) return null;
    const ok =
      (n >= TALLA_PANTALON_MIN && n <= TALLA_PANTALON_MAX && Number.isInteger(n)) ||
      (n >= TALLA_MIN &&
        n <= TALLA_MAX &&
        (Number.isInteger(n) || Math.abs((n % 1) - 0.5) < 0.01));
    if (!ok) return null;
    nums.push(n);
  }
  return nums;
}

function lineaEsPrecioHayListaTallas(linea) {
  const m = linea.trim().match(/^(\d+(?:[.,]\d{1,2})?)\s+hay\s+(.+)$/iu);
  if (!m) return false;
  return parseListaNumerosTrasHay(m[2].trim()) !== null;
}

function precioNumericoDeLineaPrecioHay(linea) {
  const m = linea.trim().match(/^(\d+(?:[.,]\d{1,2})?)\s+hay\s+/iu);
  if (!m) return NaN;
  return aNumero(m[1]);
}

function extraerListaTallasTrasHay(linea) {
  const m = linea.trim().match(/^(\d+(?:[.,]\d{1,2})?)\s+hay\s+(.+)$/iu);
  if (!m || !lineaEsPrecioHayListaTallas(linea)) return [];
  const parsed = parseListaNumerosTrasHay(m[2]);
  return parsed ?? [];
}

/** Línea que solo comunica disponibilidad: "Tallas 38,41,36 y 37" (sin precio en el mismo envío). */
function lineaEsSoloPrefijoListaTalla(linea) {
  const l = linea.trim();
  const m = l.match(/^tallas?\s+(.+)$/iu);
  if (!m) return false;
  const resto = m[1].trim();
  if (!resto) return false;
  if (!/^[\d\s,.y/]+$/iu.test(resto)) return false;
  return extraerTallasDePrefijoTallas(`tallas ${resto}`).length > 0;
}

/**
 * Lista de calzado tras prefijo Niña/Niño: "Niña 1, 2 y 3", "Niño 4 y 5" (sin confundir con preciosUSD 1–3).
 * Solo dígitos, comas y conector " y "; tallas entre TALLA_CALZADO_BEBE_MIN y TALLA_MAX.
 */
function parseLineaNinaNinoListaCalzado(linea) {
  const l = linea.trim();
  const m = l.match(/^(ni[ñn]a|ni[ñn]o)\s+(.+)$/iu);
  if (!m) return null;
  const resto = m[2].trim();
  if (!resto || !/^[\d\s,.y]+$/iu.test(resto)) return null;
  const tokens = splitListaTallasTokens(resto);
  if (tokens.length === 0) return null;
  const out = [];
  for (const t of tokens) {
    if (t.includes('/') || /[a-zA-ZÁ-ÿ]/iu.test(t)) return null;
    const n = aNumero(t.trim());
    if (Number.isNaN(n) || n < TALLA_CALZADO_BEBE_MIN || n > TALLA_MAX) return null;
    const esMedio = Math.abs((n % 1) - 0.5) < 0.01;
    if (!Number.isInteger(n) && !esMedio) return null;
    out.push(n);
  }
  return out;
}

function lineaEsNinaNinoListaCalzado(linea) {
  return parseLineaNinaNinoListaCalzado(linea) !== null;
}

/** Extrae tallas de "precio tallas 7,8,11" o "79.99 tallas 7,7.5 y 8" o "25$ tallas 30/31, 28, 29". */
function extraerTallasDePrefijoTallas(linea) {
  const m = linea.match(/\btallas?\s+(.+)$/i);
  if (!m) return [];
  const out = [];
  for (const s of splitListaTallasTokens(m[1])) {
    // Rango "30/31" → 30 y 31
    if (s.includes('/')) {
      const nums = s.split('/').map((x) => aNumero(x.trim()));
      for (const n of nums) {
        if (!Number.isNaN(n) && ((n >= TALLA_MIN && n <= TALLA_MAX) || (n >= TALLA_PANTALON_MIN && n <= TALLA_PANTALON_MAX)) && (Number.isInteger(n) || Math.abs((n % 1) - 0.5) < 0.01)) out.push(n);
      }
    } else {
      const n = aNumero(s);
      if (!Number.isNaN(n) && ((n >= TALLA_MIN && n <= TALLA_MAX) || (n >= TALLA_PANTALON_MIN && n <= TALLA_PANTALON_MAX)) && (Number.isInteger(n) || Math.abs((n % 1) - 0.5) < 0.01)) out.push(n);
    }
  }
  return out;
}

/** Extrae valores "X cm" de una línea (ej. "25.5 cm" → ["25.5 cm"]). */
function extraerTallasCmDeLinea(linea) {
  const out = [];
  const re = /\b(\d+(?:[.,]\d+)?)\s*cm\b/gi;
  let m;
  while ((m = re.exec(linea)) !== null) {
    const num = aNumero(m[1]);
    if (!Number.isNaN(num) && num > 0) out.push(`${num} cm`);
  }
  return out;
}

/**
 * Extrae todos los precios del mensaje.
 * Maneja múltiples casos:
 * - Varias líneas: cada línea es un producto
 * - Precio arriba y tallas abajo: "34.55" luego "6 7 8.5" → solo 34.55 es precio
 * - Talla primero, precio abajo: "8 1/2" luego "9.29" → solo 9.29 es precio
 * - Precio + stock por tallas: "37, solo 1 en 7 y 5.5" → solo 37 es precio (7 y 5.5 son tallas)
 * - Separador " / ": "78 color entero / metálico 84"
 * - Separador " y ": "16 y 18", "5.5 y 7 (taper)"
 * - Múltiples productos en una línea: "Tomatodo 6 (plástico) mochila 18"
 * @param {string} texto - Cuerpo del mensaje
 * @returns {{ precio: number, enSoles: boolean, conSignoDolar: boolean, nombre?: string }[]}
 */
export function extraerPrecios(texto) {
  if (!texto || typeof texto !== 'string') return [];

  const textoNorm = normalizarTexto(texto);
  const lineas = textoNorm.split(RE_NEWLINE).map((s) => s.trim()).filter(Boolean);
  const resultados = [];
  let yaHayPrecioClaro = false;

  for (const linea of lineas) {
    // "Solo 5.5 y 8": lista de tallas — primero (evita numeroAlFinal "… y 6" → precio 6)
    if (lineaEsSoloListaTallas(linea)) continue;
    // "Quedan 2 plateados 1 dorado", "Últimos 2 para lo que no confirme": stock, no precios
    if (/^quedan\s+\d+/i.test(linea) || /^últimos?\s+\d+/i.test(linea)) continue;
    // "Stock solo 1", "solo 1 und": stock/cantidad, no precio
    if (/^stock\s+solo\s+\d+/i.test(linea) || /^solo\s+\d+\s*(?:unidades?|und|stock)?\s*$/i.test(linea)) continue;
    // Talla primero (ej. "24 M") o rango edad (ej. "8-10" para NIÑO): no tomar como precios
    if (lineaEsTallaBebePrimero(linea) || lineaEsRangoTallaEdad(linea)) continue;
    // "Tallas 38,41 y 37" sólo lista de tallas pantalón/calzado, sin precios ni producto "Tallas"
    if (lineaEsSoloPrefijoListaTalla(linea)) continue;
    // "Niña 1, 2 y 3": tallas calzado bebé tras el precio, no nombre "Niña"+precios 1 y 3 ni "y"+3
    if (lineaEsNinaNinoListaCalzado(linea)) continue;
    // Si ya hubo un precio claro y esta línea es solo tallas (calzado 6-15, pantalón 26-42, "25.5 cm", o "7.6" sola), no tomar como precios
    if (
      yaHayPrecioClaro &&
      (lineaSoloTallas(linea) ||
        lineaEsTallaCm(linea) ||
        lineaSoloTallasPantalon(linea) ||
        lineaEsSoloTallaCalzadoUnicaFlexible(linea))
    ) {
      continue;
    }
    // Talla primero, precio abajo: "8 1/2" luego "9.29" o "26, 28, 30, 31" luego "32.99" → no tomar como precios
    if (!yaHayPrecioClaro && (lineaSoloTallas(linea) || lineaSoloTallasPantalon(linea)) && algunaLineaTienePrecioClaro(lineas)) continue;
    // Caso: Precio + stock por tallas "37, solo 1 en 7 y 5.5" → solo 37 es precio; 7 y 5.5 son tallas
    if (lineaEsStockPorTalla(linea)) {
      const r = extraerPrecioDeLineaConStockTallas(linea);
      if (r) {
        resultados.push(r);
        if (esPrecioClaro(r.precio)) yaHayPrecioClaro = true;
      }
      continue;
    }
    // "5.5 y 6", "6.5 a 7.5", "6 y 7" (solo tallas) o tallas tras precio arriba: no crear precios USD falsos
    if (omitirExtraerPrecioLineaTipoSoloTallas(lineas, linea, yaHayPrecioClaro)) continue;
    // "7 hombre", "10.5 mujer": talla US + género, no "precio 7 + nombre hombre"
    if (lineaEsTallaGeneroCalzado(linea)) continue;
    if (lineaEsListaTallasCalzadoConGeneroFinal(linea)) continue;
    if (lineaEsTallaCalzadoYMarciaSigla(linea)) continue;
    const hitBrasier = parseLineaListaTallasBrasierYPrecioFinal(linea);
    if (hitBrasier) {
      resultados.push({
        precio: hitBrasier.precio,
        enSoles: false,
        conSignoDolar: false,
        nombre: undefined,
      });
      yaHayPrecioClaro = true;
      continue;
    }
    // Caso "Tengo 4 un a 19.99": cantidad + precio — extraer solo el precio
    const matchTengo = linea.match(/\btengo\s+\d+\s*(?:un\s*)?a\s+(\d+(?:[.,]\d{1,2})?)\s*$/i);
    if (matchTengo) {
      const valor = aNumero(matchTengo[1]);
      if (!Number.isNaN(valor) && valor > 0) {
        resultados.push({ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined });
        yaHayPrecioClaro = true;
      }
      continue;
    }

    // Caso "49.99 solo 1", "Solo 1 21.99": precio + stock — extraer solo el precio (no 1 como precio)
    const matchPrecioSolo = linea.match(/^(\d+(?:[.,]\d{1,2})?)\s+solo\s+\d+/i) || linea.match(/^solo\s+\d+\s+(\d+(?:[.,]\d{1,2})?)\s*$/i);
    if (matchPrecioSolo) {
      const valor = aNumero(matchPrecioSolo[1]);
      if (!Number.isNaN(valor) && valor > 0) {
        resultados.push({ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined });
        yaHayPrecioClaro = true;
      }
      continue;
    }

    // Caso: "29.99 precio regular 42.50" → precio venta 29.99, precio anterior 42.50 (para mostrar rebaja)
    const matchPrecioRegular = linea.match(/^(\d+(?:[.,]\d{1,2})?)\s+precio\s+regular\s+(\d+(?:[.,]\d{1,2})?)\s*$/i);
    if (matchPrecioRegular) {
      const precioVenta = aNumero(matchPrecioRegular[1]);
      const precioAnterior = aNumero(matchPrecioRegular[2]);
      if (!Number.isNaN(precioVenta) && precioVenta > 0 && !Number.isNaN(precioAnterior) && precioAnterior > 0) {
        resultados.push({
          precio: precioVenta,
          enSoles: false,
          conSignoDolar: false,
          nombre: undefined,
          precioRegular: precioAnterior
        });
        yaHayPrecioClaro = true;
      }
      continue;
    }
    // Caso "33.7 hay 39 y 40" — un precio; 39 y 40 son tallas pantalón, no nombre "hay"+"y"
    if (lineaEsPrecioHayListaTallas(linea)) {
      const valor = precioNumericoDeLineaPrecioHay(linea);
      if (!Number.isNaN(valor) && valor > 0) {
        resultados.push({ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined });
        if (esPrecioClaro(valor)) yaHayPrecioClaro = true;
      }
      continue;
    }

    // Caso: "Conjunto 35 y 32" — nombre + precio1 y precio2 (dos prendas, dos precios)
    const patronNombreDosPrecios = /^([A-Za-zÁ-ÿ]+(?:\s+[A-Za-zÁ-ÿ]+)*?)\s+(\d+(?:[.,]\d+)?)\s+y\s+(\d+(?:[.,]\d+)?)\s*$/i;
    const matchNombreDosPrecios = linea.match(patronNombreDosPrecios);
    if (matchNombreDosPrecios) {
      const nombre = matchNombreDosPrecios[1]?.trim();
      const valor1 = aNumero(matchNombreDosPrecios[2]);
      const valor2 = aNumero(matchNombreDosPrecios[3]);
      if (!Number.isNaN(valor1) && valor1 > 0) {
        resultados.push({ precio: valor1, enSoles: false, conSignoDolar: false, nombre: nombre?.slice(0, 60) });
        if (esPrecioClaro(valor1)) yaHayPrecioClaro = true;
      }
      if (!Number.isNaN(valor2) && valor2 > 0) {
        resultados.push({ precio: valor2, enSoles: false, conSignoDolar: false, nombre: nombre?.slice(0, 60) });
        if (esPrecioClaro(valor2)) yaHayPrecioClaro = true;
      }
      continue;
    }

    // Caso: "14.99 clásico y 17.50 shimmer" — precio1 nombre1 y precio2 nombre2
    const patronPrecioNombreY = /^(\d+(?:[.,]\d+)?)\s+([A-Za-zÁ-ÿ]+)\s+y\s+(\d+(?:[.,]\d+)?)\s+([A-Za-zÁ-ÿ]+)\s*$/i;
    const matchPrecioNombreY = linea.match(patronPrecioNombreY);
    if (matchPrecioNombreY) {
      const valor1 = aNumero(matchPrecioNombreY[1]);
      const nombre1 = matchPrecioNombreY[2]?.trim();
      const valor2 = aNumero(matchPrecioNombreY[3]);
      const nombre2 = matchPrecioNombreY[4]?.trim();
      if (!Number.isNaN(valor1) && valor1 > 0) {
        resultados.push({ precio: valor1, enSoles: false, conSignoDolar: false, nombre: nombre1?.slice(0, 60) });
        if (esPrecioClaro(valor1)) yaHayPrecioClaro = true;
      }
      if (!Number.isNaN(valor2) && valor2 > 0) {
        resultados.push({ precio: valor2, enSoles: false, conSignoDolar: false, nombre: nombre2?.slice(0, 60) });
        if (esPrecioClaro(valor2)) yaHayPrecioClaro = true;
      }
      continue;
    }

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
        if (esPrecioClaro(valor1)) yaHayPrecioClaro = true;
      }
      if (!Number.isNaN(valor2) && valor2 > 0) {
        resultados.push({ precio: valor2, enSoles: false, conSignoDolar: false, nombre: nombre2?.slice(0, 80) });
        if (esPrecioClaro(valor2)) yaHayPrecioClaro = true;
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
        if (esPrecioClaro(valor1)) yaHayPrecioClaro = true;
      }
      if (!Number.isNaN(valor2) && valor2 > 0) {
        resultados.push({ precio: valor2, enSoles: false, conSignoDolar: false, nombre: textoAdicional });
        if (esPrecioClaro(valor2)) yaHayPrecioClaro = true;
      }
      continue;
    }

    // Caso 3: Separador " / ": "78 color entero / metálico 84"
    if (linea.includes(' / ')) {
      const partes = linea.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
      for (const parte of partes) {
        const r = extraerDeLinea(parte);
        if (r) {
          resultados.push(r);
          if (esPrecioClaro(r.precio)) yaHayPrecioClaro = true;
        }
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
        if (multiples.some((m) => esPrecioClaro(m.precio))) yaHayPrecioClaro = true;
        continue;
      }
    }

    // Una línea que es solo número tipo talla (ej. 7.6, 11.5) nunca debe ser USD aquí — extraerTallas lo toma cuando hay precio en otras líneas
    if (lineaEsSoloTallaCalzadoUnicaFlexible(linea)) continue;

    // Caso 5: Línea normal: "76 mochila", "Pijamas 19", "Medias 3.5 (1 par)"
    const r = extraerDeLinea(linea);
    if (r) {
      resultados.push(r);
      if (esPrecioClaro(r.precio)) yaHayPrecioClaro = true;
    }
  }

  // Si no encontramos por líneas, intentar todo el texto como un solo bloque
  if (resultados.length === 0) {
    const textoTrim = textoNorm.trim();
    const lineasFallback = textoTrim.split(/\r?\n|\r/).map((s) => s.trim()).filter(Boolean);
    const soloListaTallaUnaLinea =
      lineasFallback.length === 1 && lineaEsSoloPrefijoListaTalla(lineasFallback[0]);
    const soloNinaNinoTallasUnaLinea =
      lineasFallback.length === 1 && lineaEsNinaNinoListaCalzado(lineasFallback[0]);
    const soloTallaCalzadoUnaLinea =
      lineasFallback.length === 1 && lineaEsSoloTallaCalzadoUnicaFlexible(lineasFallback[0]);
    const skipSoloTallasOCaption =
      lineasFallback.length === 1 &&
      omitirExtraerPrecioLineaTipoSoloTallas(lineasFallback, lineasFallback[0], false);
    const skipSoloListaPrefijoTallas =
      lineasFallback.length === 1 && lineaEsSoloListaTallas(lineasFallback[0]);
    const skipTallaMarcaSigla =
      lineasFallback.length === 1 && lineaEsTallaCalzadoYMarciaSigla(lineasFallback[0]);
    const skipFallback =
      soloListaTallaUnaLinea ||
      soloNinaNinoTallasUnaLinea ||
      soloTallaCalzadoUnaLinea ||
      skipSoloTallasOCaption ||
      skipSoloListaPrefijoTallas ||
      skipTallaMarcaSigla ||
      /^stock\s+solo\s+\d+/i.test(textoTrim) ||
      /^solo\s+\d+\s*(?:unidades?|und|stock)?\s*$/i.test(textoTrim) ||
      /^quedan\s+\d+/i.test(textoTrim) ||
      /^últimos?\s+\d+/i.test(textoTrim);
    if (!skipFallback) {
      const r = extraerDeLinea(textoTrim);
      if (r) resultados.push(r);
    }
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
/** "Solo N" cantidad/u stock (captura número completo: evita partir 7.5 en 7 — bug alerta ⚠️). */
const RE_ALERTA_SOLO_CANTIDAD = /\bsolo\s+\d+(?:[.,]\d+)?\b/gi;

/** Patrones de alertas de stock (Últimas unidades, 2 últimos, etc.). */
const RE_ALERTAS_STOCK = [
  /últimas?\s+unidades?(!+|\s*!!?)?/gi,
  /\d+\s*últimos?/gi,
  RE_ALERTA_SOLO_CANTIDAD,
  /quedan\s+\d+/gi,
  /últimos?\s+\d+/gi,
];

/**
 * Extrae alertas de stock del texto (ej. "Últimas unidades !!", "2 últimos").
 * @param {string} texto
 * @returns {string[]} Frases de alerta encontradas
 */
export function extraerAlertasStock(texto) {
  if (!texto || typeof texto !== 'string') return [];
  const textoNorm = normalizarTexto(texto);
  const lineasFiltradasAlertaSolo = textoNorm.split(/\r?\n|\r/).filter((ln) => {
    const l = ln.trim();
    return l && !lineaEsSoloListaTallas(l);
  });
  const textoSinSoloTallas = lineasFiltradasAlertaSolo.join('\n');
  const encontradas = new Set();
  for (const re of RE_ALERTAS_STOCK) {
    const regex = new RegExp(re.source, re.flags);
    const blanco =
      regex.source === RE_ALERTA_SOLO_CANTIDAD.source ? textoSinSoloTallas : textoNorm;
    let m;
    while ((m = regex.exec(blanco)) !== null) {
      encontradas.add(m[0].trim());
    }
  }
  return [...encontradas];
}

export function extraerPrecio(texto) {
  const arr = extraerPrecios(texto);
  return arr.length > 0 ? arr[0] : null;
}

/** True si un número está en rango de talla y no es precio (ej. 6, 9.5, 10). */
function esTalla(valor) {
  if (valor < TALLA_MIN || valor > TALLA_MAX) return false;
  if (esPrecioClaro(valor)) return false;
  const esMedio = Math.abs((valor % 1) - 0.5) < 0.01;
  return Number.isInteger(valor) || esMedio;
}

/** Tallas en letras (ropa): orden de aparición para mostrar. Coincidir de más largo a más corto (XXL antes de XL). */
const TALLAS_LETRAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL'];
// (?<!@) en S: evita matchear la "s" de "chic@s" como talla (el @ rompe la palabra y \bS\b matchearía mal)
const RE_TALLA_LETRA = /\b(XXS|XS|(?<!@)S|M|L|XXL|2XL|3XL|4XL|XL)\b/gi;

/** Extrae tallas en letras de una línea (M, L, XL, etc.). */
function extraerTallasLetrasDeLinea(linea) {
  const out = [];
  let m;
  const re = new RegExp(RE_TALLA_LETRA.source, 'gi');
  while ((m = re.exec(linea)) !== null) {
    out.push(m[1].toUpperCase());
  }
  return out;
}

/** Indica si una línea tiene solo tallas (números en rango O letras M/L/XL) y no precio. */
function lineaSoloTallasOLetras(linea) {
  const l = linea.trim();
  if (!l) return false;
  if (/\$|S\/\s*\d|precio\s*:?\s*\d|USD\s*\d|\d\s*USD/i.test(l)) return false;
  const numeros = (l.match(/\b\d+(?:[.,]\d+)?\b/g) || []).map((s) => aNumero(s)).filter((n) => !Number.isNaN(n));
  const tieneNumeroPrecio = numeros.some((v) => v > 20 || /\.\d{2}$/.test(String(v)));
  if (tieneNumeroPrecio) return false;
  const tieneNumeroTalla = numeros.length > 0 && numeros.every((v) => v >= TALLA_MIN && v <= TALLA_MAX);
  const tieneTallasLetras = new RegExp(RE_TALLA_LETRA.source, 'i').test(l);
  return tieneNumeroTalla || tieneTallasLetras;
}

/** Cualquier salto de línea (WhatsApp puede enviar \n, \r\n o \r). */
const RE_NEWLINE = /\r?\n|\r/;

/**
 * Números que son CANTIDAD (unidades) y no tallas: "solo 3 und", "6 und", "pack 2", "7 pares", "Hay 4 und".
 */
function numerosQueSonCantidad(texto) {
  const cantidades = new Set();
  const m1 = texto.matchAll(/(\d+)\s*(?:und|unidades?)\b/gi);
  for (const m of m1) cantidades.add(aNumero(m[1]));
  const m2 = texto.matchAll(/\bllevando\s+(\d+)\b/gi);
  for (const m of m2) cantidades.add(parseInt(m[1], 10));
  const m3 = texto.matchAll(/\bpack\s+(\d+)\b/gi);
  for (const m of m3) cantidades.add(parseInt(m[1], 10));
  const m4 = texto.matchAll(/(\d+)\s*(?:pares?|medias?|medías?)\b/gi);
  for (const m of m4) cantidades.add(parseInt(m[1], 10));
  const m5 = texto.matchAll(/\btengo\s+(\d+)\b/gi);
  for (const m of m5) cantidades.add(parseInt(m[1], 10));
  return cantidades;
}

/**
 * Números que son pulgadas de pantalla/equipo, no talla de calzado.
 * Incluye marcador explícito (" 13") o "pulg"/inch, y "laptop 15.6" / "notebook 13" inmediato tras la palabra.
 */
function numerosQueSonPulgadas(texto) {
  const s = new Set();
  if (!texto || typeof texto !== 'string') return s;
  const reMarcador =
    /\b(\d+(?:\.\d+)?)\s*(?:"|″|\u2033|\u201d|(?:pulg\.?adas?|pulg\.)\b|inch(?:es)?\b)/gi;
  for (const m of texto.matchAll(reMarcador)) {
    const v = aNumero(m[1]);
    if (!Number.isNaN(v)) s.add(v);
  }
  const reTrasEquipo =
    /\b(?:laptop|notebook|tablet|ipad|macbook(?:\s+(?:air|pro))?)\s+(\d{1,2}(?:\.\d+)?)\b/gi;
  for (const m of texto.matchAll(reTrasEquipo)) {
    const v = aNumero(m[1]);
    if (!Number.isNaN(v) && v >= 8 && v <= 22) s.add(v);
  }
  return s;
}

/** Patrones "Desde X hasta Y" o "X a Y" para rango de tallas (opcional: la/el: "desde la 6 hasta la 8.5"). */
const RE_RANGO_DESDE_HASTA =
  /desde\s+(?:(?:la|las|el|los)\s+)?(\d+(?:[.,]\d+)?)\s+hasta\s+(?:(?:la|las|el|los)\s+)?(\d+(?:[.,]\d+)?)/i;
const RE_RANGO_A = /(\d+(?:[.,]\d+)?)\s+(?:a|al)\s+(?:(?:la|las|el|los)\s+)?(\d+(?:[.,]\d+)?)/i;

/**
 * Si la línea describe un rango de tallas (ej. "Desde 6.5 hasta 8", "desde la 6 hasta la 8.5"), devuelve [min, max] o null.
 * Solo si ambos números están en rango de talla de calzado (2-15).
 */
function extraerRangoTallas(linea) {
  const l = linea.trim();
  let match = l.match(RE_RANGO_DESDE_HASTA);
  if (!match) match = l.match(RE_RANGO_A);
  if (!match) return null;
  const min = aNumero(match[1]);
  const max = aNumero(match[2]);
  if (Number.isNaN(min) || Number.isNaN(max) || min > max) return null;
  if (min < TALLA_MIN || max > TALLA_MAX) return null;
  return [min, max];
}

/** Línea tipo "desde X hasta Y" sin precio XX.XX — no tratarla como productos con nombre "Desde la" / "hasta la". */
function lineaSoloDescripRangoCalzado(linea) {
  if (extraerRangoTallas(linea) === null) return false;
  return !/\d+[.,]\d{2}\b/.test(linea);
}

/**
 * No interpretar como USD: captions solo tallas (foto sin precio) — "5.5 y 6", "6 y 8", rangos "6.5 a 7.5".
 * Si yaHayPrecioClaro viene de una línea anterior, esta línea nunca debe generar segundo/tercer precio falso por "patron Y".
 * Excepción "10 y 11" sólo cuando el mensaje entero parece sólo esa línea sin precios (dos enteros ≥10 → dos USD posibles).
 */
function omitirExtraerPrecioLineaTipoSoloTallas(lineas, linea, yaHayPrecioClaroYa) {
  if (lineaSoloDescripRangoCalzado(linea)) return true;
  if (!lineaSoloTallas(linea)) return false;
  const nums = (linea.match(/\b\d+(?:[.,]\d+)?\b/g) || [])
    .map((s) => aNumero(s))
    .filter((n) => !Number.isNaN(n));
  const sinPrecioEnOtroLugar = !yaHayPrecioClaroYa && !algunaLineaTienePrecioClaro(lineas);
  if (
    sinPrecioEnOtroLugar &&
    nums.length === 2 &&
    nums.every((n) => Number.isInteger(n)) &&
    nums[0] >= 10 &&
    nums[1] >= 10
  ) {
    return false;
  }
  return true;
}

/** Genera todas las tallas entre min y max en pasos de 0.5 (6.5, 7, 7.5, 8). */
function expandirRangoTallas(min, max) {
  const out = [];
  for (let v = min; v <= max; v += 0.5) {
    const redondo = Math.round(v * 2) / 2; // evitar 7.0000001
    if (redondo >= TALLA_MIN && redondo <= TALLA_MAX) out.push(redondo);
  }
  return out;
}

/** Normaliza texto: Unicode, tallas "7 1/2" → 7.5, y signos finales para permitir "159!" como precio. */
function normalizarTexto(texto) {
  return String(texto)
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '') // zero-width chars
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/\b(\d+)\s+1\/2\b/g, '$1.5') // "7 1/2" → 7.5, "8 1/2" → 8.5 (tallas, no precios)
    .replace(/(\d+(?:[.,]\d+)?)\s*[!?]+(\s|$)/g, '$1$2') // "159!" → "159", "45?" → "45"
    .trim();
}

/**
 * Extrae tallas del mensaje: numéricas (6, 9.5) y en letras (M, L, XL).
 * En la misma línea que el precio o en líneas siguientes (ej. "14.99" luego "M L XL").
 * También talla primero, precio abajo (ej. "8 1/2" luego "9.29" → talla 8.5).
 * @param {string} texto - Cuerpo del mensaje
 * @returns {(number|string)[]} Tallas encontradas (números ordenados, luego letras en orden S→XL)
 */
export function extraerTallas(texto) {
  if (!texto || typeof texto !== 'string') return [];

  const textoNorm = normalizarTexto(texto);
  const lineas = textoNorm.split(RE_NEWLINE).map((s) => s.trim()).filter(Boolean);
  const numerosCantidad = numerosQueSonCantidad(textoNorm);
  const numerosPulgadas = numerosQueSonPulgadas(textoNorm);
  // Una sola línea "7.6" / "11.5": talla sin precio (mensaje corto tras foto)
  if (lineas.length === 1 && lineaEsSoloTallaCalzadoUnicaFlexible(lineas[0])) {
    const vv = valorLineaUnicaTallaCalzado(lineas[0]);
    if (vv != null && !(typeof vv === 'number' && (numerosCantidad.has(vv) || numerosPulgadas.has(vv))))
      return [vv];
    return [];
  }

  // Caption único tipo "5.5 y 6" o rango "6.5 a 7.5" (típico foto + tallas sin precio)
  if (lineas.length === 1 && omitirExtraerPrecioLineaTipoSoloTallas(lineas, lineas[0], false)) {
    const ln = lineas[0];
    const rango = extraerRangoTallas(ln);
    if (rango) {
      const [min, max] = rango;
      const arr = expandirRangoTallas(min, max).filter(
        (v) => !(typeof v === 'number' && (numerosCantidad.has(v) || numerosPulgadas.has(v)))
      );
      return [...new Set(arr)].sort((a, b) => a - b);
    }
    const rawNums = ln.match(/\b(\d+(?:[.,]\d+)?)\b/g) || [];
    const numsSalida = [];
    for (const rs of rawNums) {
      const rawNorm = String(rs).replace(',', '.');
      if (/^\d+\.\d{2}$/.test(rawNorm)) continue;
      const v = aNumero(rs);
      if (Number.isNaN(v) || v < TALLA_MIN || v > TALLA_MAX) continue;
      const esMedio = Math.abs((v % 1) - 0.5) < 0.01;
      if (!Number.isInteger(v) && !esMedio) continue;
      if (numerosCantidad.has(v) || numerosPulgadas.has(v)) continue;
      numsSalida.push(v);
    }
    return [...new Set(numsSalida)].sort((a, b) => a - b);
  }

  const tallasNumeros = [];
  const tallasBrasier = []; // ej. "34B", "36C" (sostén / copas)
  const tallasLetras = new Set();
  const tallasCm = [];
  const tallasPrimero = []; // "24 M" (talla antes del precio)
  const tallasRangoEdad = []; // "8-10" (rango edad niño)
  const tallasTallaGenero = []; // "7 (Hombre)"
  let yaHayPrecioClaro = algunaLineaTienePrecioClaro(lineas); // Para extraer tallas en "Set Us Polo\nS\n22.99"

  for (const linea of lineas) {
    const hitBrasierTallas = parseLineaListaTallasBrasierYPrecioFinal(linea);
    if (hitBrasierTallas) {
      for (const et of hitBrasierTallas.tallasEtiquetas) tallasBrasier.push(et);
      continue;
    }
    if (lineaEsTallaBebePrimero(linea)) {
      tallasPrimero.push(linea);
      continue;
    }
    if (lineaEsRangoTallaEdad(linea)) {
      tallasRangoEdad.push(linea);
      continue;
    }
    if (lineaEsSoloListaTallas(linea)) {
      const resto = linea
        .trim()
        .replace(/^solo\s+/i, '')
        .trim()
        .replace(/^tallas?\s+/i, '')
        .trim();
      for (const v of extraerTallasDePrefijoTallas(`tallas ${resto}`)) tallasNumeros.push(v);
      continue;
    }
    if (lineaEsListaTallasCalzadoConGeneroFinal(linea)) {
      for (const et of etiquetasListaTallasCalzadoConGeneroFinal(linea)) tallasTallaGenero.push(et);
      continue;
    }
    if (lineaEsTallaCalzadoYMarciaSigla(linea)) {
      const et = etiquetaTallaCalzadoMarciaSigla(linea);
      if (et) tallasTallaGenero.push(et);
      continue;
    }
    if (lineaEsTallaGeneroCalzado(linea)) {
      const et = etiquetaTallaGenero(linea);
      if (et) tallasTallaGenero.push(et);
      continue;
    }
    if (lineaEsPrecioHayListaTallas(linea)) {
      for (const v of extraerListaTallasTrasHay(linea)) tallasNumeros.push(v);
      continue;
    }
    if (lineaEsSoloPrefijoListaTalla(linea)) {
      const m = linea.trim().match(/^tallas?\s+(.+)$/iu);
      for (const v of extraerTallasDePrefijoTallas(`tallas ${m[1].trim()}`)) tallasNumeros.push(v);
      continue;
    }
    const listaNinaNinoBebe = parseLineaNinaNinoListaCalzado(linea);
    if (listaNinaNinoBebe) {
      for (const v of listaNinaNinoBebe) tallasNumeros.push(v);
      continue;
    }
    const rawNumeros = (linea.match(/\b(\d+(?:[.,]\d+)?)\b/g) || []);
    const numerosLinea = rawNumeros.map((s) => aNumero(s)).filter((n) => !Number.isNaN(n));
    const lineaTienePrecioClaro = rawNumeros.some((raw, i) => esPrecioClaro(numerosLinea[i], raw));

    if (lineaTienePrecioClaro) yaHayPrecioClaro = true;

    // Talla primero, precio abajo: "8 1/2" luego "9.29" o "26, 28, 30, 31" luego "32.99"
    if (!yaHayPrecioClaro && algunaLineaTienePrecioClaro(lineas)) {
      if (lineaSoloTallas(linea)) {
        for (const v of numerosLinea) {
          if (v >= TALLA_MIN && v <= TALLA_MAX) tallasNumeros.push(v);
        }
      } else if (lineaSoloTallasPantalon(linea)) {
        for (const v of numerosLinea) {
          if (v >= TALLA_PANTALON_MIN && v <= TALLA_PANTALON_MAX) tallasNumeros.push(v);
        }
      }
    }

    if (yaHayPrecioClaro) {
      for (const cm of extraerTallasCmDeLinea(linea)) tallasCm.push(cm);
      if (lineaEsTallaCm(linea)) {
        // línea solo "25.5 cm": no extraer números como tallas numéricas
      } else {
        const rango = extraerRangoTallas(linea);
        if (rango) {
          const [min, max] = rango;
          for (const v of expandirRangoTallas(min, max)) tallasNumeros.push(v);
        } else {
          if (lineaSoloTallas(linea)) {
            for (const v of numerosLinea) {
              if (v >= TALLA_MIN && v <= TALLA_MAX) tallasNumeros.push(v);
            }
          } else if (lineaSoloTallasPantalon(linea)) {
            for (const v of numerosLinea) {
              if (v >= TALLA_PANTALON_MIN && v <= TALLA_PANTALON_MAX) tallasNumeros.push(v);
            }
          } else if (lineaEsSoloTallaCalzadoUnicaFlexible(linea)) {
            const vv = valorLineaUnicaTallaCalzado(linea);
            if (vv != null) tallasNumeros.push(vv);
          } else {
            const desdePrefijoTallas = /\btallas?\s+/i.test(linea) ? extraerTallasDePrefijoTallas(linea) : [];
            if (desdePrefijoTallas.length > 0) {
              for (const v of desdePrefijoTallas) tallasNumeros.push(v);
            } else if (/^\d+(?:,\d+)+\s+\d+[.,]\d{1,2}\s*$/.test(linea)) {
              for (const v of extraerTallasDeLineaTallasPrimeroPrecioFinal(linea)) tallasNumeros.push(v);
            } else if (lineaTienePrecioClaro) {
              for (let i = 0; i < numerosLinea.length; i++) {
                const v = numerosLinea[i];
                const raw = rawNumeros[i];
                if (esPrecioClaro(v, raw)) continue; // "10.00" es precio, no talla
                if (esTalla(v)) tallasNumeros.push(v);
              }
            }
          }
        }
      }
      // Tallas en letras: misma línea (ej. "14.99 M L XL") o línea siguiente (ej. "14.99" luego "M L XL")
      if (lineaSoloTallasOLetras(linea) || lineaTienePrecioClaro) {
        for (const letra of extraerTallasLetrasDeLinea(linea)) {
          tallasLetras.add(letra);
        }
      }
    }
  }

  const nums = [...new Set(tallasNumeros)]
    .filter(
      (v) =>
        typeof v !== 'number' ||
        (!numerosCantidad.has(v) && !numerosPulgadas.has(v))
    )
    .sort((a, b) => a - b);
  const letrasOrdenadas = TALLAS_LETRAS.filter((t) => tallasLetras.has(t));
  const cmUnicas = [...new Set(tallasCm)];
  const primeroUnicas = yaHayPrecioClaro ? [...new Set(tallasPrimero)] : [];
  const rangoEdadUnicas = yaHayPrecioClaro ? [...new Set(tallasRangoEdad)] : [];
  const tallaGeneroUnicas = yaHayPrecioClaro ? [...new Set(tallasTallaGenero)] : [];
  const brasierUnicas = yaHayPrecioClaro ? [...new Set(tallasBrasier)] : [];
  return [
    ...nums,
    ...tallaGeneroUnicas,
    ...brasierUnicas,
    ...cmUnicas,
    ...letrasOrdenadas,
    ...primeroUnicas,
    ...rangoEdadUnicas,
  ];
}

/**
 * Indica si un "nombre" extraído es válido para mostrar al cliente.
 * Filtra saludos, género solo, tallas, indicadores de stock, etc.
 */
export function esNombreProductoValido(nombre) {
  if (!nombre || typeof nombre !== 'string') return false;
  const n = nombre.trim();
  if (n.length < 2) return false;
  // Solo emojis o caracteres no alfanuméricos
  if (!/[a-zA-ZÁ-ÿ0-9]/.test(n)) return false;
  // Palabras que no son nombres de producto
  const palabra = n.toLowerCase();
  const invalidos = [
    /^(buenos\s+d[ií]as|hola|buenas|chic[@a]s?|gracias)/i,
    /^[+]?\s*pedido$/i,   // "+ pedido", "a pedido"
    /^stock$/i,
    /^uno\s*a$/i,   // "Uno a" (one at)
    /^re\s*stock$/i,
    /^\d+\s*(?:ml|oz|onz|g|kg|lb)$/i,  // "100 ml" (capacidad, no nombre)
    /^(mujer|hombre)\s+[a-z]{1,3}$/i,  // "Mujer L", "Hombre M"
    /^[a-z]{1,3}\s+(mujer|hombre|nino|niño)$/i,  // "xs mujer", "L hombre"
    /^solo\s+(xs?|s|m|l|xl|xxl|xxs|\d+)\s*$/i,
    /^hay\s+(tallas?|\d+\s*und)/i,
    /^tallas?\s+/i,
    /^(m|s|l|xl|xxl|xxs|xs)\s+(y|a)\s+(m|s|l|xl|xxl|xxs|xs)/i,
    /^[msxl]+\s+a\s+[msxl]+\s*(mujer|hombre)?$/i,
    /^mujer[,.]?\s*hay\s*tallas?$/i,
    /^[a-z]\s+[a-z](\s+[a-z]+)?\s+mujer$/i,  // "m a xl mujer"
    /\bchic[@a]s\b/i,
    /^talla\s+[a-z]$/i,  // "talla S"
    /^solo\s+[a-z]$/i,   // "solo m"
    /^[a-z]+\s*,\s*hay\s*tallas?$/i,  // "mujer, hay tallas"
  ];
  if (invalidos.some((re) => re.test(n))) return false;
  // "s y xxl", "Xs y m", "m a xl mujer", "solo xs", "talla S"
  if (/^(s|m|l|xs?|xxs?|xl)\s+(y|a)\s+/.test(palabra) && /^(s|m|l|xs?|xxs?|xl|mujer|hombre)$/.test(palabra.split(/\s+/).pop())) return false;
  if (/^solo\s+(xs?|s|m|l|xl|xxl|xxs)$/i.test(palabra)) return false;
  if (/^tallas?\s+[a-z\d\s,y]+$/i.test(palabra)) return false;
  // Nombres que son solo tallas con "y": "s y xxl", "m y l"
  const partes = n.split(/\s+/);
  const tallasSolas = ['s', 'm', 'l', 'xs', 'xl', 'xxs', 'xxl', '2xl', '3xl'];
  if (partes.every((p) => tallasSolas.includes(p.toLowerCase().replace(/[,.]/g, '')) || /^[y,]|^a$/.test(p.toLowerCase()))) return false;
  return true;
}

export default extraerPrecio;
