/**
 * Logger que registra mensajes procesados en archivos por día (UTC).
 * Un archivo por día: logs/YYYY-MM-DD.jsonl (JSON Lines - una entrada por línea).
 * Cada entrada tiene: receivedAt, sentAt (UTC), grupo, textoOriginal, productos, tallas, textoEnviado, etc.
 * Útil para revisar casos especiales y mensajes mal enviados al final del día.
 */

import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');

function getArchivoDelDia() {
  const ahora = new Date();
  const y = ahora.getUTCFullYear();
  const m = String(ahora.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ahora.getUTCDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `${y}-${m}-${d}.jsonl`);
}

function toUTC() {
  return new Date().toISOString();
}

function asegurarDirectorio() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Registra un mensaje procesado (recibido y enviado).
 * @param {object} data
 * @param {string} data.receivedAt - ISO UTC string cuando se recibió
 * @param {string} [data.sentAt] - ISO UTC string cuando se envió
 * @param {string} data.grupo - Nombre del grupo
 * @param {boolean} data.tieneMedia - Si tiene imagen/media
 * @param {string} data.textoOriginal - Texto del mensaje original
 * @param {object[]} [data.productos] - Productos extraídos
 * @param {string[]} [data.tallas] - Tallas extraídas
 * @param {string} [data.textoEnviado] - Texto enviado al destino
 * @param {string} [data.tipoEnvio] - "imagen_sola" | "imagen_con_precios" | "solo_texto"
 * @param {string} [data.error] - Si hubo error
 * @param {string} [data.razonNoEnvio] - Si no se envió: "sin_media_ni_texto" | "sin_precio_extractado"
 */
export function logMensajeProcesado(data) {
  asegurarDirectorio();
  const archivo = getArchivoDelDia();
  const linea = JSON.stringify({
    receivedAt: data.receivedAt,
    sentAt: data.sentAt ?? null,
    grupo: data.grupo,
    tieneMedia: data.tieneMedia,
    textoOriginal: data.textoOriginal,
    productos: data.productos ?? [],
    tallas: data.tallas ?? [],
    textoEnviado: data.textoEnviado ?? null,
    tipoEnvio: data.tipoEnvio ?? null,
    error: data.error ?? null,
    mediaTipo: data.mediaTipo ?? null,
    razonNoEnvio: data.razonNoEnvio ?? null,
  }) + '\n';
  fs.appendFileSync(archivo, linea, 'utf8');
}

/**
 * Registra eventos que no son mensajes procesados (bienvenida, revoke, grupo detectado, etc.).
 * @param {object} data
 * @param {string} data.tipo - "bienvenida" | "revoke" | "grupo_detectado"
 * @param {string} [data.detalle] - Texto adicional
 */
export function logEvento(data) {
  asegurarDirectorio();
  const archivo = getArchivoDelDia();
  const linea = JSON.stringify({
    tipo: data.tipo,
    detalle: data.detalle ?? null,
    at: toUTC(),
  }) + '\n';
  fs.appendFileSync(archivo, linea, 'utf8');
}

/**
 * Devuelve la ruta del archivo de logs del día actual (UTC).
 */
export function getRutaLogHoy() {
  return getArchivoDelDia();
}

export default { logMensajeProcesado, logEvento, getRutaLogHoy };
