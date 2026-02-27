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

  // ID del grupo de rastreo: recibe el mensaje ORIGINAL (texto + foto) con cabecera de metadatos
  // Útil para detectar patrones de precios y mejorar el parseo. Vacío = desactivado.
  GRUPO_RASTREO_ID: process.env.GRUPO_RASTREO_ID || '',

  // Mensaje de bienvenida cuando agregan usuarios al grupo destino (en .env usa \n para saltos de línea)
  MENSAJE_BIENVENIDA: process.env.MENSAJE_BIENVENIDA
    ? String(process.env.MENSAJE_BIENVENIDA).replace(/\\n/g, '\n')
    : `¡Bienvenido(s) al grupo! 🎉

🛍️🇺🇸 PASOS PARA COMPRAR EN R&B INTERNATIONAL IMPORT 🇺🇸🛍️

📲 Las compras se realizan SOLO por CHAT PRIVADO de WhatsApp

1️⃣ Mantente atent@ a las compras en vivo en el grupo 🎥
2️⃣ Observa los productos en tiempo real 📦✨
3️⃣ Cuando veas algo que te guste, escríbenos "MÍO" por chat privado 💬
4️⃣ Te confirmamos precio y disponibilidad 💸
5️⃣ Para separar tu pedido, se debe abonar el 50% del valor del producto ✅
6️⃣ Envía tu comprobante de pago por chat privado 📲
7️⃣ El 50% restante se cancela según coordinación
8️⃣ ⏳ Tiempo de entrega: 2 a 3 semanas 📦✈️

Si tienes alguna duda, escríbenos con confianza 💕
¡Disfruta la experiencia y felices compras! ✈️🛍️`,
};

export default config;
