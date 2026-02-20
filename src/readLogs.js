/**
 * Lee y muestra los logs del día (UTC) en formato legible.
 * Uso: node src/readLogs.js [YYYY-MM-DD]
 * Sin argumentos: muestra el log de hoy (UTC).
 */

import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');

function main() {
  const fecha = process.argv[2] || new Date().toISOString().slice(0, 10);
  const archivo = path.join(LOGS_DIR, `${fecha}.jsonl`);
  if (!fs.existsSync(archivo)) {
    console.log(`No hay logs para ${fecha}`);
    console.log(`Archivo esperado: ${archivo}`);
    return;
  }
  const lineas = fs.readFileSync(archivo, 'utf8').trim().split('\n').filter(Boolean);
  console.log(`\n=== Logs ${fecha} (UTC) - ${lineas.length} entrada(s) ===\n`);
  for (let i = 0; i < lineas.length; i++) {
    try {
      const e = JSON.parse(lineas[i]);
      if (e.tipo) {
        console.log(`[${e.at}] ${e.tipo}: ${e.detalle || ''}`);
      } else {
        console.log(`--- Mensaje ${i + 1} ---`);
        console.log(`  Recibido (UTC): ${e.receivedAt}`);
        console.log(`  Enviado (UTC):  ${e.sentAt ?? '(no enviado)'}`);
        console.log(`  Grupo: ${e.grupo}`);
        console.log(`  Texto original: ${e.textoOriginal || '(vacío)'}`);
        console.log(`  Productos: ${JSON.stringify(e.productos)}`);
        console.log(`  Tallas: ${e.tallas?.join(', ') || '—'}`);
        console.log(`  Tipo envío: ${e.tipoEnvio ?? '—'}`);
        if (e.textoEnviado) console.log(`  Texto enviado:\n    ${e.textoEnviado.replace(/\n/g, '\n    ')}`);
        if (e.error) console.log(`  ⚠ Error: ${e.error}`);
        if (e.razonNoEnvio) console.log(`  ❌ Razón no envío: ${e.razonNoEnvio}`);
        console.log('');
      }
    } catch (_) {
      console.log(`  [línea no válida] ${lineas[i].slice(0, 80)}...`);
    }
  }
}

main();
