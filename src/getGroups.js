/**
 * Script de utilidad: lista todos los grupos con su ID.
 * Úsalo para copiar GRUPO_ORIGEN_ID y GRUPO_DESTINO_ID a .env o config.js
 *
 * Ejecutar: node src/getGroups.js
 */
import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

const chromePath =
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox'],
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
