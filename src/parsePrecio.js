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
 * - Precio + tallas en misma línea: "16.99 tallas 7,8,11,12,10" (solo 16.99 es precio; 7,8,11,12,10 son tallas)
 * - Precio rebaja: "29.99 precio regular 42.50" (29.99=venta, 42.50=antes; precioRegular opcional)
 * - Tallas primero, precio al final: "7,10,11 24.99" (7,10,11=tallas, 24.99=precio)
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

/** Rango de tallas de pantalón (cintura en pulgadas): 24-42. Usado para detectar "26, 28, 30, 31" debajo del precio. */
const TALLA_PANTALON_MIN = 24;
const TALLA_PANTALON_MAX = 42;

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

  // Caso "2x47", "3x29.99": cantidad x precio
  const matchCantidadPrecio = l.match(/^(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*$/i);
  if (matchCantidadPrecio) {
    const cantidad = parseInt(matchCantidadPrecio[1], 10);
    const valor = aNumero(matchCantidadPrecio[2]);
    if (cantidad > 0 && !Number.isNaN(valor) && valor > 0) {
      return [{ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined, cantidad }];
    }
  }

  // Caso "16.99 tallas 7,8,11,12,10": precio + palabra "tallas" + lista separada por comas (NO decimales)
  const matchPrecioTallas = l.match(/^(\d+(?:[.,]\d{1,2})?)\s+tallas\s+[\d,\s]+$/i);
  if (matchPrecioTallas) {
    const valor = aNumero(matchPrecioTallas[1]);
    if (!Number.isNaN(valor) && valor > 0) {
      return [{ precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined }];
    }
  }

  // Caso "30 oz 16.99" o "30 oz 16.99 40 oz 19.99": cantidad + unidad + precio (uno o varios)
  const matchesCantidadUnidad = l.matchAll(/(\d+)\s*(oz|ml|g|kg|lb)\s+(\d+(?:[.,]\d{1,2})?)/gi);
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

  // Caso "2x47", "3x29.99": cantidad x precio
  const matchCantidadPrecio = l.match(/^(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*$/i);
  if (matchCantidadPrecio) {
    const cantidad = parseInt(matchCantidadPrecio[1], 10);
    const valor = aNumero(matchCantidadPrecio[2]);
    if (cantidad > 0 && !Number.isNaN(valor) && valor > 0) {
      return { precio: valor, enSoles: false, conSignoDolar: false, nombre: undefined, cantidad };
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
 */
function lineaSoloTallas(linea) {
  const l = linea.trim();
  if (!l) return false;
  if (/\$|S\/\s*\d|precio\s*:?\s*\d|USD\s*\d|\d\s*USD/i.test(l)) return false;
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

/** True si la línea es rango de talla/edad (ej. "8-10", "2-4" para niño). No tomar 8 y 10 como precios. */
function lineaEsRangoTallaEdad(linea) {
  const l = linea.trim();
  if (!l) return false;
  const m = l.match(/^(\d{1,2})-(\d{1,2})\s*$/);
  if (!m) return false;
  const a = aNumero(m[1]);
  const b = aNumero(m[2]);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return false;
  return a >= 0 && b <= 20; // rango típico talla/edad niño (0-20)
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

/** Extrae tallas de "precio tallas 7,8,11,12,10" — los números tras "tallas" separados por coma son tallas (no decimales). */
function extraerTallasDePrefijoTallas(linea) {
  const m = linea.match(/\btallas\s+([\d,\s.5]+)$/i);
  if (!m) return [];
  const parte = m[1];
  return parte
    .split(',')
    .map((s) => aNumero(s.trim()))
    .filter((n) => !Number.isNaN(n) && n >= TALLA_MIN && n <= TALLA_MAX && (Number.isInteger(n) || Math.abs((n % 1) - 0.5) < 0.01));
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
    // Talla primero (ej. "24 M") o rango edad (ej. "8-10" para NIÑO): no tomar como precios
    if (lineaEsTallaBebePrimero(linea) || lineaEsRangoTallaEdad(linea)) continue;
    // Si ya hubo un precio claro y esta línea es solo tallas (calzado 6-15, pantalón 26-42, o "25.5 cm"), no tomar como precios
    if (yaHayPrecioClaro && (lineaSoloTallas(linea) || lineaEsTallaCm(linea) || lineaSoloTallasPantalon(linea))) continue;
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

    // Caso 5: Línea normal: "76 mochila", "Pijamas 19", "Medias 3.5 (1 par)"
    const r = extraerDeLinea(linea);
    if (r) {
      resultados.push(r);
      if (esPrecioClaro(r.precio)) yaHayPrecioClaro = true;
    }
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
/** Patrones de alertas de stock (Últimas unidades, 2 últimos, etc.). */
const RE_ALERTAS_STOCK = [
  /últimas?\s+unidades?(!+|\s*!!?)?/gi,
  /\d+\s*últimos?/gi,
  /solo\s+\d+/gi,
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
  const encontradas = new Set();
  for (const re of RE_ALERTAS_STOCK) {
    let m;
    const regex = new RegExp(re.source, re.flags);
    while ((m = regex.exec(texto)) !== null) {
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
 * Números que son CANTIDAD (unidades) y no tallas: "solo 3 und", "6 und", "Llevando 2", "Hay 4 und".
 */
function numerosQueSonCantidad(texto) {
  const cantidades = new Set();
  const m1 = texto.matchAll(/(\d+)\s*(?:und|unidades?)\b/gi);
  for (const m of m1) cantidades.add(aNumero(m[1]));
  const m2 = texto.matchAll(/\bllevando\s+(\d+)\s/gi);
  for (const m of m2) cantidades.add(parseInt(m[1], 10));
  return cantidades;
}

/** Patrones "Desde X hasta Y" o "X a Y" para rango de tallas. */
const RE_RANGO_DESDE_HASTA = /desde\s+(\d+(?:[.,]\d+)?)\s+hasta\s+(\d+(?:[.,]\d+)?)/i;
const RE_RANGO_A = /(\d+(?:[.,]\d+)?)\s+(?:a|al)\s+(\d+(?:[.,]\d+)?)/i;

/**
 * Si la línea describe un rango de tallas (ej. "Desde 6.5 hasta 8"), devuelve [min, max] o null.
 * Solo si ambos números están en rango de talla (2-15).
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
  const tallasNumeros = [];
  const tallasLetras = new Set();
  const tallasCm = [];
  const tallasPrimero = []; // "24 M" (talla antes del precio)
  const tallasRangoEdad = []; // "8-10" (rango edad niño)
  let yaHayPrecioClaro = false;

  for (const linea of lineas) {
    if (lineaEsTallaBebePrimero(linea)) {
      tallasPrimero.push(linea);
      continue;
    }
    if (lineaEsRangoTallaEdad(linea)) {
      tallasRangoEdad.push(linea);
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
          } else if (/\btallas\s+[\d,\s.5]+$/i.test(linea)) {
            for (const v of extraerTallasDePrefijoTallas(linea)) tallasNumeros.push(v);
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
      // Tallas en letras: misma línea (ej. "14.99 M L XL") o línea siguiente (ej. "14.99" luego "M L XL")
      if (lineaSoloTallasOLetras(linea) || lineaTienePrecioClaro) {
        for (const letra of extraerTallasLetrasDeLinea(linea)) {
          tallasLetras.add(letra);
        }
      }
    }
  }

  const nums = [...new Set(tallasNumeros)].filter((v) => typeof v !== 'number' || !numerosCantidad.has(v)).sort((a, b) => a - b);
  const letrasOrdenadas = TALLAS_LETRAS.filter((t) => tallasLetras.has(t));
  const cmUnicas = [...new Set(tallasCm)];
  const primeroUnicas = yaHayPrecioClaro ? [...new Set(tallasPrimero)] : [];
  const rangoEdadUnicas = yaHayPrecioClaro ? [...new Set(tallasRangoEdad)] : [];
  return [...nums, ...cmUnicas, ...letrasOrdenadas, ...primeroUnicas, ...rangoEdadUnicas];
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
    /^(mujer|hombre|niño|nino)\s*$/i,
    /^(mujer|hombre)\s+[a-z]{1,3}$/i,  // "Mujer L", "Hombre M"
    /^[a-z]{1,3}\s+(mujer|hombre|nino|niño)$/i,  // "xs mujer", "L hombre"
    /^solo\s+(xs?|s|m|l|xl|xxl|xxs|\d+)\s*$/i,
    /^hay\s+(tallas?|\d+\s*und)/i,
    /^tallas?\s+/i,
    /^desde\s*$/i,
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
