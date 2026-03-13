import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { config } from '../config.js';
import { extraerPrecios, extraerTallas, extraerAlertasStock, esNombreProductoValido } from './parsePrecio.js';
import { calcularPrecioVenta } from './calcularPrecioVenta.js';
import { logMensajeProcesado, logEvento } from './logger.js';

const GRUPO_ORIGEN = config.GRUPO_ORIGEN_ID;
const GRUPO_DESTINO = config.GRUPO_DESTINO_ID;
const GRUPO_RASTREO = config.GRUPO_RASTREO_ID || '';
const TIPO_CAMBIO = config.TIPO_CAMBIO_SOLES;
const MONEDA_ORIGEN = config.MONEDA_ORIGEN;

const faltaConfigurarGrupos = !GRUPO_ORIGEN || !GRUPO_DESTINO;

/** Mapa id mensaje origen → id mensaje destino: para borrar en destino cuando eliminen en origen. */
const MAPA_ORIGEN_DESTINO = new Map();
const MAX_MAPA_MENSAJES = 500;

/** Quita locks de Chromium para permitir nueva instancia (evita "profile is in use" / "browser is already running"). */
function limpiarBloqueoChromium() {
  try {
    const authDir = path.join(process.cwd(), '.wwebjs_auth');
    if (!fs.existsSync(authDir)) return;
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
  } catch (_) {}
}

/** En Linux, mata procesos Chrome/Chromium que usan nuestro perfil (zombies tras crash). */
function matarChromiumZombie() {
  if (process.platform !== 'linux') return;
  try {
    const authDir = path.join(process.cwd(), '.wwebjs_auth');
    if (!fs.existsSync(authDir)) return;
    // Solo matar Chrome/Chromium con --user-data-dir apuntando a nuestro perfil (no el proceso Node)
    execSync('pkill -f "user-data-dir.*\\.wwebjs_auth" || true', { stdio: 'ignore', timeout: 5000 });
    console.log('Procesos Chrome zombie (perfil wwebjs) terminados si existían');
  } catch (_) {}
}

limpiarBloqueoChromium();
matarChromiumZombie();

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

/** Envía al grupo de rastreo el mensaje ORIGINAL con cabecera de metadatos para análisis de precios. */
async function enviarMensajeRastreo(msg, chat, cuerpo) {
  if (!GRUPO_RASTREO) return;
  try {
    const idChat = chat.id._serialized;
    const nombreGrupo = chat.name;
    const idMsg = msg.id._serialized;
    const ts = msg.timestamp ? msg.timestamp * 1000 : Date.now();
    const fecha = new Date(ts).toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    let pushname = '';
    let numero = '';
    let name = '';
    try {
      const contact = await msg.getContact();
      pushname = contact.pushname || '';
      numero = contact.number || msg.author?.split('@')[0] || '';
      name = contact.name || '';
    } catch (_) {}

    const lineas = [
      `📅 ${fecha}`,
      `👤 Enviado por: ${pushname || name || '(desconocido)'}`,
      pushname && pushname !== name ? `📱 Display WSP: ${pushname}` : null,
      numero ? `📞 Número: ${numero}` : null,
      `🏷️ Grupo: ${nombreGrupo} (${idChat})`,
      msg.isForwarded ? '↗️ Reenviado' : null,
      `🆔 Msg ID: ${idMsg}`,
      '',
      '--- Texto original ---',
      cuerpo || '(sin texto)',
    ].filter(Boolean);

    const cabeceraYTexto = lineas.join('\n');

    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      if (media) {
        await client.sendMessage(GRUPO_RASTREO, media, { caption: cabeceraYTexto });
      } else {
        await client.sendMessage(GRUPO_RASTREO, cabeceraYTexto);
      }
    } else {
      await client.sendMessage(GRUPO_RASTREO, cabeceraYTexto);
    }
    console.log('[Rastreo] Mensaje original enviado a grupo rastreo');
  } catch (err) {
    console.warn('Error al enviar mensaje a grupo rastreo:', err.message);
  }
}

/** Construye el texto a enviar al destino a partir del cuerpo: precios a soles, tallas, alertas. */
function construirTextoDestino(cuerpo) {
  const productos = extraerPrecios(cuerpo);
  const tienePrecio = productos.length > 0;
  let tallas = extraerTallas(cuerpo);
  const alertasStock = extraerAlertasStock(cuerpo);
  // No incluir como tallas números que son precios de productos (ej. "28" puede ser precio USD o talla pantalón)
  const preciosProductos = new Set(productos.map((p) => p.precio));
  tallas = tallas.filter((t) => typeof t !== 'number' || !preciosProductos.has(t));
  if (!tienePrecio) return { textoDestino: cuerpo, productos: [], tallas, alertasStock, tienePrecio: false };
  const lineasSoles = [];
  for (const item of productos) {
    let precioSoles;
    let precioRegularSoles = null;
    if (item.enSoles) {
      precioSoles = Math.ceil(item.precio);
      if (item.precioRegular) precioRegularSoles = Math.ceil(item.precioRegular);
    } else if (item.conSignoDolar) {
      // Precios con $ usan la misma fórmula que sin $ (impuesto, shopper, ganancia, envío)
      const { totalSoles: s } = calcularPrecioVenta(item.precio, {
        porcentajeImpuesto: config.PORCENTAJE_IMPUESTO,
        porcentajeShopper: config.PORCENTAJE_SHOPPER,
        porcentajeGanancia: config.PORCENTAJE_GANANCIA,
        envioUSD: config.ENVIO_USD,
        tipoCambioSoles: TIPO_CAMBIO,
      });
      precioSoles = s;
      if (item.precioRegular) {
        const { totalSoles: regSoles } = calcularPrecioVenta(item.precioRegular, {
          porcentajeImpuesto: config.PORCENTAJE_IMPUESTO,
          porcentajeShopper: config.PORCENTAJE_SHOPPER,
          porcentajeGanancia: config.PORCENTAJE_GANANCIA,
          envioUSD: config.ENVIO_USD,
          tipoCambioSoles: TIPO_CAMBIO,
        });
        precioRegularSoles = regSoles;
      }
    } else {
      const { totalSoles } = calcularPrecioVenta(item.precio, {
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
      }
    }
    const nombreValido = item.nombre && esNombreProductoValido(item.nombre);
    const prefixCantidad = item.cantidad && item.cantidad > 1 ? `${item.cantidad} x ` : '';
    const esDesde = nombreValido && /^desde$/i.test(item.nombre.trim());
    const disclaimerDesde = esDesde ? ' (el precio puede variar por tamaño o modelo)' : '';
    if (precioRegularSoles != null) {
      lineasSoles.push(`💰 ${prefixCantidad}Precio: S/ ${precioSoles} – Antes S/ ${precioRegularSoles}`);
    } else {
      const parteNombre = nombreValido ? `${item.nombre} – ` : '';
      lineasSoles.push(`💰 ${prefixCantidad}${parteNombre}Precio: S/ ${precioSoles}${disclaimerDesde}`);
    }
  }
  if (tallas.length > 0) lineasSoles.push(`📏 Tallas disponibles: ${tallas.join(', ')}`);
  if (alertasStock.length > 0) lineasSoles.push(`⚠️ ${alertasStock.join(' | ')}`);
  return { textoDestino: lineasSoles.join('\n'), productos, tallas, alertasStock, tienePrecio: true };
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

// Si editan un mensaje en el grupo origen, editar el correspondiente en el grupo destino
client.on('message_edit', async (message, newBody, prevBody) => {
  if (faltaConfigurarGrupos) return;
  try {
    const chat = await message.getChat();
    if (!chat.isGroup || chat.id._serialized !== GRUPO_ORIGEN) return;
    const idOrigen = message.id._serialized;
    const idDestino = MAPA_ORIGEN_DESTINO.get(idOrigen);
    if (!idDestino) return;
    const msgDestino = await client.getMessageById(idDestino);
    if (!msgDestino) return;
    const { textoDestino } = construirTextoDestino(String(newBody || '').trim() || message.body || '');
    if (!textoDestino) return;
    await msgDestino.edit(textoDestino);
    console.log('\n>>> MENSAJE EDITADO EN ORIGEN → actualizado en grupo destino <<<');
    console.log('Antes:', prevBody?.slice(0, 80) + (prevBody && prevBody.length > 80 ? '…' : ''));
    console.log('Nuevo texto destino:', textoDestino.slice(0, 120) + (textoDestino.length > 120 ? '…' : ''));
    console.log('================================\n');
    logEvento({ tipo: 'edit', detalle: `idOrigen=${idOrigen} idDestino=${idDestino}` });
  } catch (err) {
    console.warn('Error al editar mensaje en destino (message_edit):', err.message);
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

  const { textoDestino, productos, tallas, alertasStock, tienePrecio } = construirTextoDestino(cuerpo);
  if (tallas.length > 0) console.log('Tallas extraídas:', tallas.join(', '));
  else if (tienePrecio && cuerpo.includes('\n')) console.log('Tallas extraídas: (ninguna; revisar si hay segunda línea con números)');
  if (tienePrecio) {
    for (const item of productos) {
      const precioSoles = item.enSoles ? Math.ceil(item.precio) : item.conSignoDolar
        ? calcularPrecioVenta(item.precio, {
            porcentajeImpuesto: config.PORCENTAJE_IMPUESTO,
            porcentajeShopper: config.PORCENTAJE_SHOPPER,
            porcentajeGanancia: config.PORCENTAJE_GANANCIA,
            envioUSD: config.ENVIO_USD,
            tipoCambioSoles: TIPO_CAMBIO,
          }).totalSoles
        : calcularPrecioVenta(item.precio, {
            porcentajeImpuesto: config.PORCENTAJE_IMPUESTO,
            porcentajeShopper: config.PORCENTAJE_SHOPPER,
            porcentajeGanancia: config.PORCENTAJE_GANANCIA,
            envioUSD: config.ENVIO_USD,
            tipoCambioSoles: TIPO_CAMBIO,
          }).totalSoles;
      console.log(item.nombre ? `${item.nombre}: S/ ${precioSoles}` : `Precio: S/ ${precioSoles}`);
    }
  }

  const idOrigen = msg.id._serialized;

  try {
    await enviarMensajeRastreo(msg, chat, cuerpo);

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

    // 4) Solo texto sin precio: NO enviar (anuncios, saludos, coordinación)
    // Solo pasan al grupo destino los mensajes de venta (con precio o con imagen+producto)
    if (!tieneMedia && !tienePrecio) {
      console.log('\n>>> NO ENVIADO (filtrado: solo texto sin precio) <<<');
      console.log('Texto original:', (cuerpo || '').slice(0, 120) + (cuerpo && cuerpo.length > 120 ? '…' : ''));
      console.log('================================\n');
      logMensajeProcesado({
        receivedAt,
        grupo: nombreGrupo,
        tieneMedia,
        textoOriginal: cuerpo,
        productos: [],
        tallas: [],
        tipoEnvio: null,
        razonNoEnvio: 'filtrado_solo_texto_sin_precio',
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
const DELAY_DESPUES_MATAR_CHROME_MS = 5000;

async function initWithRetry() {
  for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
    try {
      await client.initialize();
      return;
    } catch (err) {
      const isRetryable =
        /Execution context was destroyed|Requesting main frame too early|Target closed|Protocol error|browser is already running/i.test(
          err.message
        );
      if (isRetryable && attempt < MAX_INIT_RETRIES) {
        console.warn(
          `Error al iniciar (intento ${attempt}/${MAX_INIT_RETRIES}): ${err.message}. Reintentando...`
        );
        limpiarBloqueoChromium();
        matarChromiumZombie();
        const delay =
          /browser is already running/i.test(err.message) ? DELAY_DESPUES_MATAR_CHROME_MS : INIT_RETRY_DELAY_MS;
        console.log(`Esperando ${delay / 1000}s antes de reintentar...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.error('Error al iniciar:', err);
        process.exit(1);
      }
    }
  }
}

initWithRetry();
