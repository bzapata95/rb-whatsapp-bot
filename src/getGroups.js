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

client.on('ready', async () => {
  const chats = await client.getChats();
  const groups = chats.filter((c) => c.isGroup);
  console.log('\n--- Grupos (copia el ID para .env) ---\n');
  for (const g of groups) {
    console.log(g.name, '→', g.id._serialized);
  }
  console.log('\n');
  await client.destroy();
  process.exit(0);
});

client.initialize().catch((e) => {
  console.error(e);
  process.exit(1);
});
