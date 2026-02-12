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

Luego `pnpm start` o `npm start` como siempre.

## Notas

- La sesión se guarda en `.wwebjs_auth`; no hace falta escanear el QR cada vez.
- Si WhatsApp cierra la sesión, borra `.wwebjs_auth` y vuelve a escanear el QR.
