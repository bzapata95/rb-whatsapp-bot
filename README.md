# Bot WhatsApp: Productos → Soles

Bot que escucha un grupo de WhatsApp, extrae mensajes con **foto + precio** (productos), convierte el precio a **Soles (S/)** con un tipo de cambio configurable y reenvía la misma foto con el precio en S/ a otro grupo.

## Requisitos

- Node.js 18+
- Cuenta de WhatsApp (escaneas QR una vez; la sesión se guarda en `.wwebjs_auth`)
- **En servidor Linux (ej. DigitalOcean):** Chromium instalado (ver más abajo)

## Instalación

```bash
npm install
```

## Configuración

### 1. Tipo de cambio y grupos

**Opción A – Archivo de configuración** (`config.js`):

- `TIPO_CAMBIO_SOLES`: tipo de cambio (ej: 3.75 = 1 USD → 3.75 S/).
- `MONEDA_ORIGEN`: moneda en los mensajes (ej: `'USD'`).
- `GRUPO_ORIGEN_ID` y `GRUPO_DESTINO_ID`: IDs de los grupos (si no usas `.env`).

**Opción B – Variables de entorno** (recomendado):

```bash
cp .env.example .env
```

Edita `.env`:

```env
GRUPO_ORIGEN_ID=123456789-1234567890@g.us
GRUPO_DESTINO_ID=987654321-0123456789@g.us
TIPO_CAMBIO_SOLES=3.75
```

### 2. Obtener los IDs de los grupos

1. Primera vez: ejecuta el bot o el script de grupos y escanea el QR con WhatsApp.
2. Listar grupos (para copiar IDs):

```bash
node src/getGroups.js
```

Copia los IDs que quieras usar como origen y destino.

## Uso

1. El bot debe estar **en ambos grupos** (origen y destino).
2. Inicia el bot:

```bash
npm start
```

3. En el **grupo origen**, cuando alguien envíe una **foto + mensaje con precio** (ej: `Producto X - $25`), el bot:
   - Detecta la foto y el texto.
   - Extrae el precio (acepta formatos como `$50`, `50 USD`, `S/ 20`, `precio: 30`, etc.).
   - Convierte a Soles con `TIPO_CAMBIO_SOLES` (si ya viene en S/, no convierte).
   - Envía al **grupo destino** la misma foto con el mensaje y el precio en S/ (ej: `Precio: S/ 93.75`).

## Cambiar el tipo de cambio

- En **config.js**: cambia `TIPO_CAMBIO_SOLES` (o `TIPO_CAMBIO_SOLES` vía `process.env` si usas dotenv).
- En **.env**: `TIPO_CAMBIO_SOLES=3.80` (o el valor que quieras).

Tras cambiar, reinicia el bot (`npm start`).

## Estructura del proyecto

```
rb-whatsapp/
├── config.js          # Tipo de cambio y IDs (fácil de editar)
├── .env.example       # Ejemplo de variables de entorno
├── src/
│   ├── index.js       # Bot: escucha grupo origen, convierte, envía a destino
│   ├── parsePrecio.js # Extrae precio (y opcional nombre) del texto
│   └── getGroups.js   # Utilidad para listar grupos y ver IDs
└── package.json
```

## Ejecutar en servidor Linux (DigitalOcean, VPS, etc.)

En el servidor no hay Chrome instalado; usa Chromium:

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y chromium-browser
```

Si el ejecutable está en otra ruta (ej. `/usr/bin/chromium-browser`), define en `.env`:

```env
CHROME_PATH=/usr/bin/chromium-browser
```

### Correr con PM2 en el Droplet

Para que el bot siga corriendo al cerrar SSH y se reinicie si se cae:

```bash
# En el servidor, dentro de la carpeta del proyecto (ej. ~/apps/rb-whatsapp-bot)
cd ~/apps/rb-whatsapp-bot   # o la ruta donde clonaste

# Instalar PM2 globalmente (una vez)
npm install -g pm2

# Crear carpeta de logs (opcional; si no, PM2 usa ~/.pm2/logs/)
mkdir -p logs

# Arrancar el bot con PM2
pm2 start ecosystem.config.cjs
```

**Comandos útiles:**

| Comando | Descripción |
|--------|-------------|
| `pm2 status` | Ver si el bot está corriendo |
| `pm2 logs rb-whatsapp` | Ver logs en vivo (ahí sale el QR si hay que escanear) |
| `pm2 restart rb-whatsapp` | Reiniciar después de cambiar .env o código |
| `pm2 stop rb-whatsapp` | Parar el bot |
| `pm2 delete rb-whatsapp` | Quitar el proceso de PM2 |

**Reinicio automático al reiniciar el servidor:**

```bash
pm2 startup
# Ejecuta el comando que te muestre (sudo env ...)
pm2 save
```

La primera vez que arranques con PM2, conecta por SSH y ejecuta `pm2 logs rb-whatsapp` para ver el QR y escanearlo con WhatsApp.

**Si sale "The profile appears to be in use by another Chromium process":**

Un Chromium anterior quedó abierto (reinicio brusco, crash, etc.). Hay que matar ese proceso y volver a arrancar:

```bash
pm2 stop rb-whatsapp
pkill -f chromium
# o, si el error muestra un PID (ej. 1258451): kill 1258451
pm2 start rb-whatsapp
pm2 logs rb-whatsapp
```

Si sigue fallando, borra el perfil del navegador (perderás la sesión de WhatsApp y tendrás que escanear el QR de nuevo):

```bash
pm2 stop rb-whatsapp
pkill -f chromium
rm -rf .wwebjs_auth/session-*
# o todo: rm -rf .wwebjs_auth
pm2 start rb-whatsapp
```

## Notas

- La sesión se guarda en `.wwebjs_auth`; no hace falta escanear el QR cada vez.
- Si WhatsApp cierra la sesión, borra `.wwebjs_auth` y vuelve a escanear el QR.
