import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { config } from '../config.js';
import { extraerPrecios, extraerTallas, extraerAlertasStock } from './parsePrecio.js';
import { calcularPrecioVenta } from './calcularPrecioVenta.js';
import { logMensajeProcesado, logEvento } from './logger.js';

const GRUPO_ORIGEN = config.GRUPO_ORIGEN_ID;
const GRUPO_DESTINO = config.GRUPO_DESTINO_ID;
const TIPO_CAMBIO = config.TIPO_CAMBIO_SOLES;
const MONEDA_ORIGEN = config.MONEDA_ORIGEN;

const faltaConfigurarGrupos = !GRUPO_ORIGEN || !GRUPO_DESTINO;

/** Mapa id mensaje origen → id mensaje destino: para borrar en destino cuando eliminen en origen. */
const MAPA_ORIGEN_DESTINO = new Map();
const MAX_MAPA_MENSAJES = 500;

// Quitar bloqueo de Chromium si quedó de otro proceso/servidor (evita "profile is in use by process X on another computer")
try {
  const authDir = path.join(process.cwd(), '.wwebjs_auth');
  if (fs.existsSync(authDir)) {
    const sessionLock = path.join(authDir, 'session', 'SingletonLock');
    if (fs.existsSync(sessionLock)) {
      fs.unlinkSync(sessionLock);
      console.log('Bloqueo de Chromium eliminado (perfil anterior)');
    }
    const dirs = fs.readdirSync(authDir, { withFileTypes: true });
    for (const d of dirs) {
      if (d.isDirectory() && d.name.startsWith('session-')) {
        const lock = path.join(authDir, d.name, 'SingletonLock');
        if (fs.existsSync(lock)) {
          fs.unlinkSync(lock);
          console.log('Bloqueo de Chromium eliminado:', d.name);
        }
      }
    }
  }
} catch (_) {}

// Ruta a Chrome/Chromium (env CHROME_PATH o PUPPETEER_EXECUTABLE_PATH para override)
function resolveChromePath() {
  if (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  if (process.platform === 'linux') {
    const paths = [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
    ];
    for (const p of paths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch (_) {}
    }
    return paths[0];
  }
  return undefined;
}
const chromePath = resolveChromePath();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  authTimeoutMs: 90000, // 90 s para detectar sesión tras escanear QR (servidor lento/headless)
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio',
      '--safebrowsing-disable-auto-update',
    ],
    ...(chromePath && { executablePath: chromePath }),
    ignoreDefaultArgs: ['--enable-automation'],
  },
});

client.on('qr', (qr) => {
  console.log('Escanea el QR con WhatsApp (Linked Devices):');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('Sesión detectada, cargando WhatsApp...');
});

client.on('loading_screen', (percent, message) => {
  console.log('Cargando:', percent, message || '');
});

client.on('ready', () => {
  if (faltaConfigurarGrupos) {
    console.log('Bot listo. Falta configurar GRUPO_ORIGEN_ID y GRUPO_DESTINO_ID en .env');
    console.log('Cuando alguien envíe un mensaje en un grupo, aquí se mostrará el ID del grupo para que lo copies.\n');
  } else {
    console.log('Bot listo. Escuchando grupo origen:', GRUPO_ORIGEN);
  }
});

function guardarMapeoOrigenDestino(idOrigen, idDestino) {
  MAPA_ORIGEN_DESTINO.set(idOrigen, idDestino);
  if (MAPA_ORIGEN_DESTINO.size > MAX_MAPA_MENSAJES) {
    const primeraClave = MAPA_ORIGEN_DESTINO.keys().next().value;
    MAPA_ORIGEN_DESTINO.delete(primeraClave);
  }
}

// Cuando agregan usuario(s) al grupo destino: enviar mensaje de bienvenida con pasos para comprar
client.on('group_join', async (notification) => {
  if (faltaConfigurarGrupos) return;
  try {
    const chat = await notification.getChat();
    if (!chat.isGroup || chat.id._serialized !== GRUPO_DESTINO) return;
    const mensaje = config.MENSAJE_BIENVENIDA;
    await notification.reply(mensaje);
    const recipients = await notification.getRecipients();
    const nombres = recipients.map((c) => c.pushname || c.name || c.number).filter(Boolean);
    console.log('\n>>> BIENVENIDA ENVIADA (grupo destino) <<<');
    console.log('Usuarios agregados:', nombres.length ? nombres.join(', ') : notification.recipientIds?.length || '?');
    console.log('================================\n');
    logEvento({ tipo: 'bienvenida', detalle: `Usuarios agregados: ${nombres.length ? nombres.join(', ') : notification.recipientIds?.length || '?'}` });
  } catch (err) {
    console.warn('Error al enviar mensaje de bienvenida:', err.message);
    logEvento({ tipo: 'bienvenida', detalle: `Error: ${err.message}` });
  }
});

// Si eliminan un mensaje en el grupo origen, eliminar también el mensaje correspondiente en el grupo destino
client.on('message_revoke_everyone', async (message, revokedMsg) => {
  if (faltaConfigurarGrupos) return;
  try {
    const chat = await message.getChat();
    if (!chat.isGroup || chat.id._serialized !== GRUPO_ORIGEN) return;
    const idOrigen = (revokedMsg && revokedMsg.id && revokedMsg.id._serialized) || message.id._serialized;
    const idDestino = MAPA_ORIGEN_DESTINO.get(idOrigen);
    if (!idDestino) return;
    const msgDestino = await client.getMessageById(idDestino);
    if (msgDestino) {
      await msgDestino.delete(true);
      console.log('\n>>> MENSAJE ELIMINADO EN ORIGEN → eliminado también en grupo destino <<<\n');
      logEvento({ tipo: 'revoke', detalle: `idOrigen=${idOrigen} idDestino=${idDestino}` });
    }
    MAPA_ORIGEN_DESTINO.delete(idOrigen);
  } catch (err) {
    console.warn('Error al eliminar mensaje en destino (revoke):', err.message);
  }
});

client.on('message', async (msg) => {
  let chat;
  try {
    chat = await msg.getChat();
  } catch (err) {
    // Chats tipo Canal o estructuras nuevas pueden fallar en la librería; ignorar
    console.warn('No se pudo obtener el chat (p. ej. canal no soportado):', err.message);
    return;
  }
  if (!chat.isGroup) return;

  const idChat = chat.id._serialized;
  const nombreGrupo = chat.name;

  // Si aún no configuraste grupos, solo mostramos el ID para que lo copies
  if (faltaConfigurarGrupos) {
    console.log(`[Grupo] "${nombreGrupo}" → ID: ${idChat}`);
    console.log('   Copia ese ID a .env como GRUPO_ORIGEN_ID o GRUPO_DESTINO_ID y reinicia el bot.\n');
    return;
  }

  if (idChat !== GRUPO_ORIGEN) return;

  const receivedAt = new Date().toISOString();
  const tieneMedia = msg.hasMedia;

  // Con imagen, el caption a veces llega después: recargar mensaje para obtener texto completo (varias líneas)
  let cuerpo = (msg.body && String(msg.body).trim()) || '';
  if (tieneMedia) {
    if (!cuerpo && msg._data?.caption) cuerpo = String(msg._data.caption).trim();
    try {
      const recargado = await msg.reload();
      if (recargado && recargado.body) {
        const bodyRecargado = String(recargado.body).trim();
        if (bodyRecargado.length > cuerpo.length) cuerpo = bodyRecargado;
      }
    } catch (_) {}
  }

  // Log del mensaje recibido del grupo origen
  console.log('\n=== MENSAJE RECIBIDO DEL GRUPO ORIGEN ===');
  console.log('Grupo:', nombreGrupo);
  console.log('Tiene imagen/media:', tieneMedia);
  console.log('Texto original:', cuerpo || '(sin texto)');
  console.log('=========================================\n');

  if (!tieneMedia && !cuerpo) {
    logMensajeProcesado({
      receivedAt,
      grupo: nombreGrupo,
      tieneMedia,
      textoOriginal: cuerpo || '(vacío)',
      productos: [],
      tallas: [],
      tipoEnvio: null,
      razonNoEnvio: 'sin_media_ni_texto',
    });
    return;
  }

  const productos = extraerPrecios(cuerpo);
  const tienePrecio = productos.length > 0;
  const tallas = extraerTallas(cuerpo);
  const alertasStock = extraerAlertasStock(cuerpo);
  if (tallas.length > 0) console.log('Tallas extraídas:', tallas.join(', '));
  else if (tienePrecio && cuerpo.includes('\n')) console.log('Tallas extraídas: (ninguna; revisar si hay segunda línea con números)');

  // Construir texto en soles cuando hay precio
  let textoDestino = '';
  if (tienePrecio) {
    const lineasSoles = [];
    for (const item of productos) {
      let precioSoles;
      let precioRegularSoles = null;
      if (item.enSoles) {
        // Ya está en soles
        precioSoles = Math.ceil(item.precio);
        if (item.precioRegular) precioRegularSoles = Math.ceil(item.precioRegular);
        console.log(item.nombre ? `${item.nombre}: Ya en soles S/ ${precioSoles}` : `Ya en soles S/ ${precioSoles}`);
      } else if (item.conSignoDolar) {
        // Tiene signo $ explícito: solo aplicar tipo de cambio (sin fórmula)
        precioSoles = Math.ceil(item.precio * TIPO_CAMBIO);
        if (item.precioRegular) precioRegularSoles = Math.ceil(item.precioRegular * TIPO_CAMBIO);
        console.log(item.nombre 
          ? `${item.nombre}: Conversión directa $${item.precio} × ${TIPO_CAMBIO} = S/ ${precioSoles}`
          : `Conversión directa $${item.precio} × ${TIPO_CAMBIO} = S/ ${precioSoles}`);
      } else {
        // Sin signo $: aplicar fórmula completa (impuesto, shopper, ganancia, envío)
        const { totalSoles, desglose } = calcularPrecioVenta(item.precio, {
          porcentajeImpuesto: config.PORCENTAJE_IMPUESTO,
          porcentajeShopper: config.PORCENTAJE_SHOPPER,
          porcentajeGanancia: config.PORCENTAJE_GANANCIA,
          envioUSD: config.ENVIO_USD,
          tipoCambioSoles: TIPO_CAMBIO,
        });
        precioSoles = totalSoles;
        if (item.precioRegular) {
          const { totalSoles: regSoles } = calcularPrecioVenta(item.precioRegular, {
            porcentajeImpuesto: config.PORCENTAJE_IMPUESTO,
            porcentajeShopper: config.PORCENTAJE_SHOPPER,
            porcentajeGanancia: config.PORCENTAJE_GANANCIA,
            envioUSD: config.ENVIO_USD,
            tipoCambioSoles: TIPO_CAMBIO,
          });
          precioRegularSoles = regSoles;
          console.log(`Precio venta $${item.precio}: ${desglose}`);
          console.log(`Precio regular $${item.precioRegular} (antes): S/ ${precioRegularSoles}`);
        } else {
          console.log(item.nombre ? `${item.nombre}: ${desglose}` : desglose);
        }
      }
      if (precioRegularSoles != null) {
        lineasSoles.push(`💰 Precio: S/ ${precioSoles} – Antes S/ ${precioRegularSoles}`);
      } else {
        lineasSoles.push(item.nombre ? `💰 ${item.nombre} Precio: S/ ${precioSoles}` : `💰 Precio: S/ ${precioSoles}`);
      }
    }
    if (tallas.length > 0) {
      lineasSoles.push(`📏 Tallas disponibles: ${tallas.join(', ')}`);
    }
    if (alertasStock.length > 0) {
      lineasSoles.push(`⚠️ ${alertasStock.join(' | ')}`);
    }
    textoDestino = lineasSoles.join('\n');
  } else {
    textoDestino = cuerpo;
  }

  const idOrigen = msg.id._serialized;

  try {
    // 1) Solo foto (sin precio): enviar imagen con el texto original como caption si hay
    if (tieneMedia && !tienePrecio) {
      const media = await msg.downloadMedia();
      if (media) {
        const caption = (cuerpo && cuerpo.trim()) ? cuerpo.trim() : undefined;
        const sent = await client.sendMessage(GRUPO_DESTINO, media, caption ? { caption } : undefined);
        const sentAt = new Date().toISOString();
        if (sent) guardarMapeoOrigenDestino(idOrigen, sent.id._serialized);
        console.log('\n>>> ENVIADO AL GRUPO DESTINO <<<');
        console.log('Tipo: Imagen sola (sin precio)');
        if (caption) console.log('Caption:', caption);
        console.log('Media tipo:', media.mimetype);
        console.log('================================\n');
        logMensajeProcesado({
          receivedAt,
          sentAt,
          grupo: nombreGrupo,
          tieneMedia,
          textoOriginal: cuerpo,
          productos: [],
          tallas,
          textoEnviado: caption ?? null,
          tipoEnvio: 'imagen_sola',
          mediaTipo: media.mimetype,
        });
      } else {
        console.warn('No se pudo descargar la imagen');
        logMensajeProcesado({
          receivedAt,
          grupo: nombreGrupo,
          tieneMedia,
          textoOriginal: cuerpo,
          productos: [],
          tallas,
          error: 'No se pudo descargar la imagen',
          razonNoEnvio: 'fallo_descarga_media',
        });
      }
      return;
    }

    // 2) Foto + texto con precio (mismo mensaje): enviar imagen con caption en soles
    if (tieneMedia && tienePrecio) {
      const media = await msg.downloadMedia();
      const sentAt = new Date().toISOString();
      if (media) {
        const sent = await client.sendMessage(GRUPO_DESTINO, media, { caption: textoDestino });
        if (sent) guardarMapeoOrigenDestino(idOrigen, sent.id._serialized);
        console.log('\n>>> ENVIADO AL GRUPO DESTINO <<<');
        console.log('Tipo: Imagen + precios convertidos');
        console.log('Media tipo:', media.mimetype);
        console.log('Caption enviado (cada línea):');
        textoDestino.split(/\r?\n|\r/).forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
        console.log('================================\n');
        logMensajeProcesado({
          receivedAt,
          sentAt,
          grupo: nombreGrupo,
          tieneMedia,
          textoOriginal: cuerpo,
          productos: productos.map((p) => ({ precio: p.precio, enSoles: p.enSoles, nombre: p.nombre })),
          tallas,
          textoEnviado: textoDestino,
          tipoEnvio: 'imagen_con_precios',
          mediaTipo: media.mimetype,
        });
      } else {
        const sent = await client.sendMessage(GRUPO_DESTINO, textoDestino);
        if (sent) guardarMapeoOrigenDestino(idOrigen, sent.id._serialized);
        console.log('\n>>> ENVIADO AL GRUPO DESTINO <<<');
        console.log('Tipo: Solo texto (falló descarga de imagen)');
        console.log('Texto enviado:');
        console.log(textoDestino);
        console.log('================================\n');
        logMensajeProcesado({
          receivedAt,
          sentAt,
          grupo: nombreGrupo,
          tieneMedia,
          textoOriginal: cuerpo,
          productos: productos.map((p) => ({ precio: p.precio, enSoles: p.enSoles, nombre: p.nombre })),
          tallas,
          textoEnviado: textoDestino,
          tipoEnvio: 'solo_texto',
          error: 'Falló descarga de imagen',
        });
      }
      return;
    }

    // 3) Solo texto con precio: enviar solo el texto (precios en soles)
    if (!tieneMedia && tienePrecio) {
      const sent = await client.sendMessage(GRUPO_DESTINO, textoDestino);
      const sentAt = new Date().toISOString();
      if (sent) guardarMapeoOrigenDestino(idOrigen, sent.id._serialized);
      console.log('\n>>> ENVIADO AL GRUPO DESTINO <<<');
      console.log('Tipo: Solo texto con precios convertidos');
      console.log('Texto enviado:');
      console.log(textoDestino);
      console.log('================================\n');
      logMensajeProcesado({
        receivedAt,
        sentAt,
        grupo: nombreGrupo,
        tieneMedia,
        textoOriginal: cuerpo,
        productos: productos.map((p) => ({ precio: p.precio, enSoles: p.enSoles, nombre: p.nombre })),
        tallas,
        textoEnviado: textoDestino,
        tipoEnvio: 'solo_texto',
      });
    }

    // 4) Solo texto sin precio (ej. "Tallas disponibles"): reenviar el texto tal cual
    if (!tieneMedia && !tienePrecio && textoDestino) {
      const sent = await client.sendMessage(GRUPO_DESTINO, textoDestino);
      const sentAt = new Date().toISOString();
      if (sent) guardarMapeoOrigenDestino(idOrigen, sent.id._serialized);
      console.log('\n>>> ENVIADO AL GRUPO DESTINO <<<');
      console.log('Tipo: Solo texto (sin precio)');
      console.log('Texto enviado:', textoDestino);
      console.log('================================\n');
      logMensajeProcesado({
        receivedAt,
        sentAt,
        grupo: nombreGrupo,
        tieneMedia,
        textoOriginal: cuerpo,
        productos: [],
        tallas,
        textoEnviado: textoDestino,
        tipoEnvio: 'solo_texto',
      });
    }
  } catch (err) {
    console.error('Error al reenviar:', err.message);
    logMensajeProcesado({
      receivedAt,
      grupo: nombreGrupo,
      tieneMedia,
      textoOriginal: cuerpo,
      productos: productos?.map((p) => ({ precio: p.precio, enSoles: p.enSoles, nombre: p.nombre })) ?? [],
      tallas: tallas ?? [],
      error: err.message,
      razonNoEnvio: 'error_al_reenviar',
    });
  }
});

// Reintentos al iniciar (en servidor la página puede navegar y destruir el context)
const MAX_INIT_RETRIES = 5;
const INIT_RETRY_DELAY_MS = 8000;

async function initWithRetry() {
  for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
    try {
      await client.initialize();
      return;
    } catch (err) {
      const isRetryable =
        /Execution context was destroyed|Requesting main frame too early|Target closed|Protocol error/i.test(err.message);
      if (isRetryable && attempt < MAX_INIT_RETRIES) {
        console.warn(
          `Error al iniciar (intento ${attempt}/${MAX_INIT_RETRIES}): ${err.message}. Reintentando en ${INIT_RETRY_DELAY_MS / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, INIT_RETRY_DELAY_MS));
      } else {
        console.error('Error al iniciar:', err);
        process.exit(1);
      }
    }
  }
}

initWithRetry();
