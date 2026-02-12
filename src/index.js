import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { config } from '../config.js';
import { extraerPrecios } from './parsePrecio.js';
import { calcularPrecioVenta } from './calcularPrecioVenta.js';

const GRUPO_ORIGEN = config.GRUPO_ORIGEN_ID;
const GRUPO_DESTINO = config.GRUPO_DESTINO_ID;
const TIPO_CAMBIO = config.TIPO_CAMBIO_SOLES;
const MONEDA_ORIGEN = config.MONEDA_ORIGEN;

const faltaConfigurarGrupos = !GRUPO_ORIGEN || !GRUPO_DESTINO;

// Ruta a Chrome/Chromium (env CHROME_PATH o PUPPETEER_EXECUTABLE_PATH para override)
const chromePath =
  process.env.CHROME_PATH ||
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : process.platform === 'linux'
        ? '/usr/bin/chromium-browser'
        : undefined);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
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

client.on('ready', () => {
  if (faltaConfigurarGrupos) {
    console.log('Bot listo. Falta configurar GRUPO_ORIGEN_ID y GRUPO_DESTINO_ID en .env');
    console.log('Cuando alguien envíe un mensaje en un grupo, aquí se mostrará el ID del grupo para que lo copies.\n');
  } else {
    console.log('Bot listo. Escuchando grupo origen:', GRUPO_ORIGEN);
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

  const tieneMedia = msg.hasMedia;
  const cuerpo = msg.body?.trim() || '';

  if (!tieneMedia && !cuerpo) return;

  const productos = extraerPrecios(cuerpo);
  const tienePrecio = productos.length > 0;

  // Mensaje solo texto sin precio: no reenviar
  if (!tieneMedia && !tienePrecio) return;

  // Construir texto en soles cuando hay precio
  let textoDestino = '';
  if (tienePrecio) {
    const lineasSoles = [];
    for (const item of productos) {
      let precioSoles;
      if (item.enSoles) {
        precioSoles = Math.ceil(item.precio);
      } else {
        const { totalSoles, desglose } = calcularPrecioVenta(item.precio, {
          porcentajeImpuesto: config.PORCENTAJE_IMPUESTO,
          porcentajeShopper: config.PORCENTAJE_SHOPPER,
          porcentajeGanancia: config.PORCENTAJE_GANANCIA,
          envioUSD: config.ENVIO_USD,
          tipoCambioSoles: TIPO_CAMBIO,
        });
        precioSoles = totalSoles;
        console.log(item.nombre ? `${item.nombre}: ${desglose}` : desglose);
      }
      lineasSoles.push(item.nombre ? `💰 ${item.nombre} Precio: S/ ${precioSoles}` : `💰 Precio: S/ ${precioSoles}`);
    }
    textoDestino = lineasSoles.join('\n');
  }

  try {
    // 1) Solo foto (sin precio): enviar solo la imagen
    if (tieneMedia && !tienePrecio) {
      const media = await msg.downloadMedia();
      if (media) {
        await client.sendMessage(GRUPO_DESTINO, media);
        console.log('Enviado a grupo destino: imagen sola');
      } else {
        console.warn('No se pudo descargar la imagen');
      }
      return;
    }

    // 2) Foto + texto con precio (mismo mensaje): enviar imagen con caption en soles
    if (tieneMedia && tienePrecio) {
      const media = await msg.downloadMedia();
      if (media) {
        await client.sendMessage(GRUPO_DESTINO, media, { caption: textoDestino });
        console.log('Enviado a grupo destino: imagen + precios', textoDestino);
      } else {
        await client.sendMessage(GRUPO_DESTINO, textoDestino);
        console.log('Enviado a grupo destino: solo texto (falló descarga)', textoDestino);
      }
      return;
    }

    // 3) Solo texto con precio: enviar solo el texto (precios en soles)
    if (!tieneMedia && tienePrecio) {
      await client.sendMessage(GRUPO_DESTINO, textoDestino);
      console.log('Enviado a grupo destino: precios', textoDestino);
    }
  } catch (err) {
    console.error('Error al reenviar:', err.message);
  }
});

client.initialize().catch((err) => {
  console.error('Error al iniciar:', err);
  process.exit(1);
});
