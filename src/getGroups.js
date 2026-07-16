/**
 * Script de utilidad: lista todos los grupos con su ID.
 * Úsalo para copiar GRUPO_ORIGEN_ID y GRUPO_DESTINO_ID a .env o config.js
 *
 * Ejecutar: node src/getGroups.js
 */
import 'dotenv/config';
import fs from 'fs';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

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
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
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
  authTimeoutMs: 90000,
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    ...(chromePath && { executablePath: chromePath }),
  },
});

client.on('qr', (qr) => {
  console.log('Escanea el QR si es la primera vez:');
  qrcode.generate(qr, { small: true });
});

/** Lee los grupos directo del Store del navegador.
 * client.getChats() construye modelos de TODOS los chats (incluidos canales/newsletter)
 * y revienta con el error "r" en wwebjs 1.34.x + WA Web 2.3000.x. */
async function listarGruposDesdeStore() {
  return client.pupPage.evaluate(() => {
    const Chat =
      window.require?.('WAWebCollections')?.Chat || window.Store?.Chat;
    if (!Chat) throw new Error('Store de chats no disponible aún');
    const modelos = Chat.getModelsArray?.() || Chat.models || [];
    return modelos
      .map((c) => ({
        id: c?.id?._serialized || '',
        name: c?.formattedTitle || c?.name || c?.id?.user || '(sin nombre)',
      }))
      .filter((c) => c.id.endsWith('@g.us'));
  });
}

client.on('ready', async () => {
  console.log('Sesión lista, leyendo grupos...');
  let groups = null;
  for (let intento = 1; intento <= 5; intento++) {
    try {
      groups = await listarGruposDesdeStore();
      if (groups.length > 0) break;
    } catch (err) {
      console.warn(`Intento ${intento}/5 falló: ${err.message}`);
    }
    // El Store puede tardar en poblarse tras ready
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!groups || groups.length === 0) {
    console.error('No se pudieron leer los grupos. Vuelve a intentar en unos segundos.');
    await client.destroy().catch(() => {});
    process.exit(1);
  }

  console.log('\n--- Grupos (copia el ID para .env) ---\n');
  for (const g of groups) {
    console.log(g.name, '→', g.id);
  }
  console.log('\n');
  await client.destroy().catch(() => {});
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('Error no manejado:', err?.message || err);
});

client.initialize().catch((e) => {
  console.error(e);
  process.exit(1);
});
