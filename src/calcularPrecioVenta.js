/**
 * Fórmula de precio para productos USA → venta en Soles.
 * Orden: no salir en pérdidas y mantener ganancia.
 *
 * 1. Precio unitario USD (base)
 * 2. + % impuesto/costo (ej. 6.5%)
 * 3. + % comisión shopper (ej. 20%) sobre lo anterior
 * 4. + % ganancia (ej. 15%) sobre lo anterior
 * 5. + Envío fijo USD (ej. 10)
 * 6. Total USD → Soles (tipo de cambio)
 */

/**
 * @param {number} precioUnitarioUSD - Precio del producto en USD
 * @param {object} opts - Configuración (porcentajes y tipo de cambio)
 * @returns {{ totalSoles: number, totalUSD: number, desglose: string }}
 */
export function calcularPrecioVenta(precioUnitarioUSD, opts = {}) {
  const {
    porcentajeImpuesto = 6.5,
    porcentajeShopper = 20,
    porcentajeGanancia = 15,
    envioUSD = 10,
    tipoCambioSoles = 3.75,
  } = opts;

  const redondear = (n, d = 2) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);

  // 1. Base + impuesto (6.5%)
  const conImpuesto = precioUnitarioUSD * (1 + porcentajeImpuesto / 100);

  // 2. + comisión shopper (20%)
  const conShopper = conImpuesto * (1 + porcentajeShopper / 100);

  // 3. + ganancia (15%)
  const conGanancia = conShopper * (1 + porcentajeGanancia / 100);

  // 4. + envío fijo USD
  const totalUSD = conGanancia + envioUSD;

  // 5. Convertir a Soles y redondear hacia arriba (sin decimales)
  const totalSoles = Math.ceil(totalUSD * tipoCambioSoles);

  const desglose =
    `Precio USD: $${redondear(precioUnitarioUSD)} → +${porcentajeImpuesto}% → +${porcentajeShopper}% shopper → +${porcentajeGanancia}% ganancia → +$${envioUSD} envío = $${redondear(totalUSD)} → S/ ${totalSoles}`;

  return {
    totalSoles,
    totalUSD: redondear(totalUSD, 2),
    desglose,
  };
}

export default calcularPrecioVenta;
