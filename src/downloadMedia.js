/**
 * Descarga de media robusta para wwebjs 1.34.x + WhatsApp Web 2.3000.x.
 * downloadMedia() nativo falla a veces con error "r" (Msg.get / LID). Fallback:
 * descargar y desencriptar en el navegador con WAWebDownloadManager usando
 * directPath/mediaKey que ya vienen en el propio evento del mensaje.
 */
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;

/** Id serializado del mensaje. */
export function getSerializedMessageId(message) {
  if (!message?.id) return null;
  if (typeof message.id === 'string') return message.id;
  if (message.id._serialized) return message.id._serialized;

  const remote =
    message.id.remote?._serialized ||
    message.id.remote ||
    message.from ||
    null;
  const id = message.id.id;
  if (remote == null || id == null) return null;

  const fromMe = Boolean(message.id.fromMe || message.fromMe);
  return `${fromMe}_${remote}_${id}`;
}

function getShortMessageId(message) {
  return message?.id?.id || getSerializedMessageId(message)?.split('_').pop() || null;
}

/**
 * Metadatos de media ya presentes en el mensaje del evento.
 * Evita Msg.get (falla con LID → msg-not-found).
 */
function extractMediaMeta(message) {
  const d = message._data || {};
  let mediaKey = d.mediaKey || message.mediaKey || null;
  // Puppeteer serializa por JSON: asegurar string/base64 simple
  if (mediaKey && typeof mediaKey !== 'string') {
    try {
      if (Array.isArray(mediaKey) || ArrayBuffer.isView(mediaKey)) {
        mediaKey = Buffer.from(mediaKey).toString('base64');
      } else {
        mediaKey = String(mediaKey);
      }
    } catch {
      mediaKey = null;
    }
  }

  return {
    msgId: getSerializedMessageId(message),
    shortId: getShortMessageId(message),
    chatId: message.from || (typeof d.from === 'string' ? d.from : d.from?._serialized) || null,
    directPath: d.directPath || null,
    encFilehash: d.encFilehash || null,
    filehash: d.filehash || null,
    mediaKey,
    mediaKeyTimestamp: d.mediaKeyTimestamp || null,
    type: message.type || d.type || 'image',
    mimetype: d.mimetype || null,
    filename: d.filename || null,
    size: d.size || null,
  };
}

/**
 * Descarga media a base64 en RAM (sin disco).
 * 1) Usa directPath/mediaKey del propio mensaje
 * 2) Busca el msg en Store por id corto / chat
 */
export async function downloadMediaBase64(client, message) {
  const meta = extractMediaMeta(message);
  const page = client.pupPage;
  if (!page) throw new Error('Sin pupPage');

  console.log(
    `[Media] Descarga fallback | msgId=${meta.msgId || 'null'} shortId=${meta.shortId || 'null'} hasPath=${Boolean(meta.directPath)} hasKey=${Boolean(meta.mediaKey)}`
  );

  if (!meta.directPath && !meta.msgId && !meta.shortId) {
    throw new Error('Sin directPath ni id de mensaje para descargar media');
  }

  const result = await page.evaluate(async (meta) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const getDownloadManager = () =>
      window.require('WAWebDownloadManager')?.downloadManager ||
      window.Store?.DownloadManager;

    const toBase64 = async (buffer) => {
      if (window.WWebJS?.arrayBufferToBase64Async) {
        return window.WWebJS.arrayBufferToBase64Async(buffer);
      }
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    };

    const findMsg = async () => {
      try {
        const collections = window.require('WAWebCollections');
        const Msg = collections.Msg;

        if (meta.msgId) {
          let msg = Msg.get(meta.msgId);
          if (msg) return msg;
          const found = await Msg.getMessagesById([meta.msgId]);
          if (found?.messages?.[0]) return found.messages[0];
        }

        const models =
          Msg.getModelsArray?.() ||
          Msg.models ||
          [];

        if (meta.shortId) {
          const byShort = models.find(
            (m) =>
              m?.id?.id === meta.shortId ||
              String(m?.id?._serialized || '').endsWith(`_${meta.shortId}`)
          );
          if (byShort) return byShort;
        }

        if (meta.chatId) {
          let chat = collections.Chat.get(meta.chatId);
          if (!chat) {
            try {
              const wid = window
                .require('WAWebWidFactory')
                .createWid(meta.chatId);
              chat = await collections.Chat.find(wid);
            } catch {
              chat = null;
            }
          }
          const chatMsgs =
            chat?.msgs?.getModelsArray?.() || chat?.msgs?.models || [];
          if (meta.shortId) {
            const inChat = chatMsgs.find(
              (m) =>
                m?.id?.id === meta.shortId ||
                String(m?.id?._serialized || '').includes(meta.shortId)
            );
            if (inChat) return inChat;
          }
        }
      } catch (err) {
        return { __findError: String(err?.message || err) };
      }
      return null;
    };

    const decryptWithMeta = async (m) => {
      const downloadManager = getDownloadManager();
      if (!downloadManager?.downloadAndMaybeDecrypt) {
        throw new Error('downloadManager-missing');
      }

      const directPath = m.directPath || meta.directPath;
      const mediaKey = m.mediaKey || meta.mediaKey;
      if (!directPath || !mediaKey) {
        throw new Error(
          `missing-keys path=${Boolean(directPath)} key=${Boolean(mediaKey)}`
        );
      }

      const decrypted = await downloadManager.downloadAndMaybeDecrypt({
        directPath,
        encFilehash: m.encFilehash || meta.encFilehash,
        filehash: m.filehash || meta.filehash,
        mediaKey,
        mediaKeyTimestamp: m.mediaKeyTimestamp || meta.mediaKeyTimestamp,
        type: m.type || meta.type,
        signal: new AbortController().signal,
        downloadQpl: {
          addAnnotations() {
            return this;
          },
          addPoint() {
            return this;
          },
        },
      });

      if (!decrypted) throw new Error('decrypt-empty');

      return {
        ok: true,
        data: await toBase64(decrypted),
        mimetype: m.mimetype || meta.mimetype || 'application/octet-stream',
        filename: m.filename || meta.filename || null,
        filesize: m.size || meta.size || null,
        via: m.__via || 'meta',
      };
    };

    try {
      let metaErr = null;

      // A) Datos del evento (sin buscar en Store) — clave con autores @lid
      if (meta.directPath && meta.mediaKey) {
        try {
          return await decryptWithMeta({ __via: 'event-meta' });
        } catch (err) {
          metaErr = String(err?.message || err);
        }
      }

      // B) Localizar mensaje en Store (LID / sync)
      let msg = null;
      let findError = null;
      for (let i = 0; i < 20; i++) {
        const found = await findMsg();
        if (found?.__findError) {
          findError = found.__findError;
        } else if (found) {
          msg = found;
          break;
        }
        await sleep(400);
      }

      if (!msg) {
        return {
          ok: false,
          error: findError ? `find-error:${findError}` : 'msg-not-found',
          metaErr,
          hadEventMeta: Boolean(meta.directPath && meta.mediaKey),
        };
      }

      for (let i = 0; i < 20; i++) {
        const stage = msg.mediaData?.mediaStage;
        if (
          (stage === 'RESOLVED' || msg.directPath) &&
          (msg.mediaKey || meta.mediaKey)
        ) {
          break;
        }
        try {
          if (typeof msg.downloadMedia === 'function') {
            await msg.downloadMedia({
              downloadEvenIfExpensive: true,
              rmrReason: 1,
            });
          }
        } catch {
          // ignore
        }
        await sleep(400);
      }

      msg.__via = 'store-msg';
      return await decryptWithMeta(msg);
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || err),
        name: err?.name || null,
      };
    }
  }, meta);

  if (!result?.ok) {
    throw new Error(
      `download-base64: ${result?.error || 'unknown'}` +
        (result?.metaErr ? ` metaErr=${result.metaErr}` : '') +
        (result?.hadEventMeta === false ? ' (sin directPath/mediaKey en evento)' : '')
    );
  }

  console.log(`[Media] OK vía ${result.via || 'unknown'}`);
  return new MessageMedia(
    result.mimetype,
    result.data,
    result.filename || undefined,
    result.filesize || undefined
  );
}

/**
 * Intenta downloadMedia() nativo; si falla (error "r"), usa el fallback en RAM.
 * Devuelve MessageMedia listo para client.sendMessage.
 */
export async function downloadMediaInMemory(client, message) {
  try {
    if (message.hasMedia && typeof message.downloadMedia === 'function') {
      const media = await message.downloadMedia();
      if (media?.data) return media;
    }
  } catch (err) {
    console.warn('[Media] downloadMedia() nativo falló:', err.message);
  }

  return downloadMediaBase64(client, message);
}
