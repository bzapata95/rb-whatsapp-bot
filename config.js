/**
 * Configuración del bot - aquí cambias tipo de cambio y grupos fácilmente.
 *
 * Cómo obtener el ID de un grupo:
 * 1. Agrega el bot al grupo (o usa un grupo donde ya esté).
 * 2. En la consola se imprimen los IDs cuando llega un mensaje, o usa getGroups.js.
 * 3. El ID tiene formato: 123456789-1234567890@g.us
 */

export const config = {
  // Tipo de cambio: 1 USD = X soles (cámbialo aquí o con env TIPO_CAMBIO_SOLES)
  TIPO_CAMBIO_SOLES: Number(process.env.TIPO_CAMBIO_SOLES) || 3.75,

  // --- Fórmula de precio (productos USA → venta en Soles) ---
  // Sobre precio unitario USD: + impuesto 6.5% → + shopper 20% → + ganancia 15% → + envío fijo → convertir a S/
  PORCENTAJE_IMPUESTO: Number(process.env.PORCENTAJE_IMPUESTO) || 6.5,   // % sobre precio unitario
  PORCENTAJE_SHOPPER: Number(process.env.PORCENTAJE_SHOPPER) || 20,     // % sobre (precio + impuesto)
  PORCENTAJE_GANANCIA: Number(process.env.PORCENTAJE_GANANCIA) || 15,   // % sobre (precio + impuesto + shopper)
  ENVIO_USD: Number(process.env.ENVIO_USD) || 10,                       // USD fijo por envío

  // Moneda que usan en los mensajes de origen (para detectar precios)
  MONEDA_ORIGEN: 'USD',

  // ID del grupo del que se LEEN los productos (foto + mensaje con precio)
  GRUPO_ORIGEN_ID: process.env.GRUPO_ORIGEN_ID || '',

  // ID del grupo al que se ENVÍAN los productos ya con precio en S/
  GRUPO_DESTINO_ID: process.env.GRUPO_DESTINO_ID || '',
};

export default config;
