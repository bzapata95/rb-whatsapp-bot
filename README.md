# Bot WhatsApp - Conversor de Precios USD → Soles

## 📋 Descripción del Proyecto

Bot automatizado de WhatsApp que escucha mensajes en un **grupo origen** (donde se publican productos con precios en USD), convierte los precios a Soles peruanos aplicando una fórmula de costos y márgenes, y reenvía los productos con el nuevo precio al **grupo destino**.

### ⚡ Tabla de Referencia Rápida

| Formato de Entrada | Precios Detectados | Tipo de Conversión | Ejemplo de Salida |
|-------------------|-------------------|-------------------|-------------------|
| `76 mochila` | 76 USD | Fórmula completa | 💰 mochila Precio: S/ 429 |
| `$28 mochila` | 28 USD | Solo tipo cambio | 💰 mochila Precio: S/ 96 |
| `28$ entra laptop` | 28 USD | Solo tipo cambio | 💰 entra laptop Precio: S/ 96 |
| `16 y 18` | 16 y 18 USD | Fórmula completa | 💰 Precio: S/ 110<br>💰 Precio: S/ 119 |
| `4 pares 8$` | 8 USD | Solo tipo cambio | 💰 4 pares Precio: S/ 28 |
| `Pijamas 19` | 19 USD | Fórmula completa | 💰 Pijamas Precio: S/ 80 |
| `Medias 3.5 (1 par)` | 3.5 USD | Fórmula completa | 💰 Medias Precio: S/ 18 |
| `Tomatodo 6 mochila 18` | 6 y 18 USD | Fórmula completa | 💰 Tomatodo Precio: S/ 31<br>💰 mochila Precio: S/ 76 |
| `S/ 50` | 50 Soles | Sin conversión | 💰 Precio: S/ 50 |

### ¿Qué hace el bot?

1. **Monitorea** el grupo origen esperando mensajes con productos
2. **Detecta** precios en diferentes formatos (USD, $, números, S/)
3. **Calcula** el precio de venta en Soles aplicando:
   - Impuesto/costo (6.5%)
   - Comisión shopper (20%)
   - Margen de ganancia (15%)
   - Costo de envío fijo ($10 USD)
   - Tipo de cambio USD → Soles (3.40)
4. **Reenvía** al grupo destino:
   - Solo imágenes (si no hay precio)
   - Imágenes con caption de precio en Soles
   - Solo texto con precios convertidos

## 🏗️ Estructura del Proyecto

```
rb-whatsapp/
├── src/
│   ├── index.js              # Bot principal - lógica de escucha y reenvío
│   ├── parsePrecio.js        # Extrae precios del texto (múltiples formatos)
│   ├── calcularPrecioVenta.js # Fórmula USD → Soles con costos
│   └── getGroups.js          # Utilidad: lista IDs de grupos
├── config.js                 # Configuración central (tipo de cambio, porcentajes)
├── .env                      # Variables de entorno (IDs de grupos)
└── package.json
```

## 🔧 Archivos Clave

### `src/index.js` - Bot Principal

- Inicializa cliente WhatsApp con `whatsapp-web.js`
- Escucha mensajes del grupo origen
- Detecta si el mensaje tiene:
  - Media (imagen/foto)
  - Texto con precios
- Aplica conversión de precios
- Reenvía al grupo destino
- **Logs detallados** de mensajes recibidos y enviados

### `src/parsePrecio.js` - Extractor de Precios

Detecta precios en múltiples formatos:

**Formatos simples:**
- `76 mochila` → precio USD + nombre
- `Mochila 76` → nombre + precio USD
- `Pijamas 19` → nombre + precio
- `Medias 3.5` → nombre + precio decimal
- `$50`, `28$` → precio con signo dólar
- `S/ 20` → precio ya en soles (no se convierte)

**Formatos múltiples en una línea:**
- `16 y 18` → dos precios separados por "y" (sin nombres)
- `Set 16 y plato 18` → dos precios con nombres individuales
- `5.5 y 7 (taper)` → dos decimales + descripción compartida
- `78 color entero / metálico 84` → separados por "/"
- `Tomatodo 6 (plástico) mochila 18` → **captura automática de nombres: "Tomatodo" y "mochila"**

**Formatos especiales:**
- `4 pares 8$` → cantidad + precio con $
- `28$ entra laptop` → precio + descripción
- Múltiples líneas → cada línea es un producto

**Reglas importantes (grupo en USD):**
- **Soles:** Solo se interpreta como Soles si el texto tiene **"S/"** explícito (con barra). Sin "S/", todo se trata como USD.
- **Tallas:** Números como 6, 6.5, 7, 7.5, 8.5, 11, 13 en contexto de talla (ej. "39.99 us 6 mujer", "29.99 7.5, 8.5", "entra laptop de 13") **no** se toman como precios; se usa solo el precio con formato XX.XX (ej. 39.99, 29.99).
- **Cálculo:** El bot **siempre calcula** cada precio extraído (fórmula completa o solo tipo de cambio según el caso) y envía al grupo destino el valor **en Soles (S/ XX)**. No se envía el número crudo en USD.

### `src/calcularPrecioVenta.js` - Fórmula de Conversión

**Dos modos de conversión:**

#### 1. Con signo `$` explícito: **Conversión directa**
Si el precio incluye el símbolo `$` (ej: `$28`, `28$`), solo se aplica el tipo de cambio:
```
Precio USD × Tipo de cambio = Precio en Soles
```
**Ejemplo:** `28$ entra laptop`
```
$28 × 3.40 = S/ 96
```

#### 2. Sin signo `$`: **Fórmula completa**
Si el precio NO tiene símbolo `$` (ej: `76 mochila`, `Mochila 76`), se aplica la fórmula completa:
```
Precio Base USD
→ + 6.5% (impuesto)
→ + 20% (comisión shopper)
→ + 15% (ganancia)
→ + $10 (envío fijo)
→ × Tipo de cambio
→ = Precio Final en Soles (redondeado hacia arriba)
```
**Ejemplo:** `76 mochila`
```
$76 → +6.5% → +20% shopper → +15% ganancia → +$10 envío = $126.23 → S/ 429
```

### `config.js` - Configuración

Centraliza toda la configuración:
- Tipo de cambio (por defecto 3.75, sobreescribible con `.env`)
- Porcentajes de impuesto, shopper, ganancia
- Costo de envío fijo
- IDs de grupos origen y destino

## 🚀 Cómo Funciona

### Flujo de Mensajes

```
GRUPO ORIGEN                          BOT                           GRUPO DESTINO
────────────                         ─────                          ─────────────
📸 + "76 mochila"          →    Fórmula completa         →    📸 + "💰 mochila Precio: S/ 429"
📸 + "$28 mochila"         →    Solo tipo de cambio      →    📸 + "💰 mochila Precio: S/ 96"
📸 + "28$ entra laptop"    →    Solo tipo de cambio      →    📸 + "💰 entra laptop Precio: S/ 96"
📸 + "16 y 18"             →    Fórmula completa (×2)    →    📸 + "💰 Precio: S/ 110\n💰 Precio: S/ 119"
📸 + "4 pares 8$"          →    Solo tipo de cambio      →    📸 + "💰 4 pares Precio: S/ 28"
📸 + "Tomatodo 6 mochila 18" → Fórmula completa (×2)    →    📸 + "💰 Tomatodo Precio: S/ 31\n💰 mochila Precio: S/ 76"
📸 Solo imagen              →    Sin precio detectado     →    📸 (solo imagen)
"Pijamas 19"               →    Fórmula completa         →    "💰 Pijamas Precio: S/ 80"
"Medias 3.5 (1 par)"       →    Fórmula completa         →    "💰 Medias Precio: S/ 18"
"S/ 50"                    →    Ya está en soles         →    "💰 Precio: S/ 50"
```

### Casos de Uso

1. **Imagen + precio con `$`**: Conversión directa (solo tipo de cambio)
   - `$28 mochila` → S/ 96
   - `28$ entra laptop` → S/ 96
   
2. **Imagen + precio sin `$`**: Fórmula completa (impuestos + márgenes + envío)
   - `76 mochila` → S/ 429
   - `Mochila 76` → S/ 429
   
3. **Solo imagen**: Reenvía solo la imagen (sin conversión)

4. **Solo texto con precio**: Reenvía texto con precio convertido (según tenga o no `$`)

5. **Texto sin precio**: No se reenvía

6. **Precio ya en S/**: Se mantiene en soles, no se convierte

### Casos con tallas: se extrae el precio USD y se calcula a Soles

Cuando el mensaje mezcla precio y tallas (ej. "39.99 us 6"), el bot **extrae solo el precio** (39.99 USD) y **lo calcula** con la fórmula como siempre. Lo que se envía al grupo es el **valor en Soles**, no el número crudo:

| Mensaje recibido | Precio extraído (USD) | Cálculo aplicado | Enviado al grupo destino |
|------------------|------------------------|------------------|---------------------------|
| `6.5 21.99` (6.5 = talla) | 21.99 | Fórmula completa | 💰 Precio: S/ 97 |
| `39.99 us 6 mujer new balance` | 39.99 | Fórmula completa | 💰 Precio: S/ 184 |
| `Nuevos 29.99!!` | 29.99 | Fórmula completa | 💰 Precio: S/ 135 |
| `49.99 8.5, 9.5, 11` (tallas) | 49.99 | Fórmula completa | 💰 Precio: S/ 224 |
| `29.99 7.5, 8.5` (tallas) | 29.99 | Fórmula completa | 💰 Precio: S/ 135 |
| `27.99 3 compartimientos` | 27.99 | Fórmula completa | 💰 Precio: S/ 125 |
| `S/ 50` | 50 (soles) | Sin conversión | 💰 Precio: S/ 50 |

*(Los S/ exactos dependen de tipo de cambio y porcentajes en config; la tabla ilustra que siempre se calcula y se envía en Soles.)*

## 📊 Logs del Sistema

El bot muestra logs detallados:

**Ejemplo 1: Sin signo `$` (fórmula completa)**
```
=== MENSAJE RECIBIDO DEL GRUPO ORIGEN ===
Grupo: Productos USA
Tiene imagen/media: true
Texto original: 76 mochila
=========================================

mochila: Precio USD: $76 → +6.5% → +20% shopper → +15% ganancia → +$10 envío = $126.23 → S/ 429

>>> ENVIADO AL GRUPO DESTINO <<<
Tipo: Imagen + precios convertidos
Media tipo: image/jpeg
Caption enviado:
💰 mochila Precio: S/ 429
================================
```

**Ejemplo 2: Con signo `$` (conversión directa)**
```
=== MENSAJE RECIBIDO DEL GRUPO ORIGEN ===
Grupo: Productos USA
Tiene imagen/media: true
Texto original: 28$ entra laptop
=========================================

entra laptop: Conversión directa $28 × 3.4 = S/ 96

>>> ENVIADO AL GRUPO DESTINO <<<
Tipo: Imagen + precios convertidos
Media tipo: image/jpeg
Caption enviado:
💰 entra laptop Precio: S/ 96
================================
```

**Ejemplo 3: Múltiples precios separados por "y"**
```
=== MENSAJE RECIBIDO DEL GRUPO ORIGEN ===
Grupo: Compras grupales en 🇺🇸
Tiene imagen/media: true
Texto original: 16 y 18
=========================================

Precio USD: $16 → +6.5% → +20% shopper → +15% ganancia → +$10 envío = $32.23 → S/ 110
Precio USD: $18 → +6.5% → +20% shopper → +15% ganancia → +$10 envío = $34.76 → S/ 119

>>> ENVIADO AL GRUPO DESTINO <<<
Tipo: Imagen + precios convertidos
Media tipo: image/jpeg
Caption enviado:
💰 Precio: S/ 110
💰 Precio: S/ 119
================================
```

**Ejemplo 4: Múltiples productos en una línea con nombres**
```
=== MENSAJE RECIBIDO DEL GRUPO ORIGEN ===
Grupo: Compras grupales en 🇺🇸
Tiene imagen/media: true
Texto original: Tomatodo 6 (plástico) mochila 18
=========================================

Tomatodo: Precio USD: $6 → +6.5% → +20% shopper → +15% ganancia → +$10 envío = $18.23 → S/ 62
mochila: Precio USD: $18 → +6.5% → +20% shopper → +15% ganancia → +$10 envío = $34.76 → S/ 119

>>> ENVIADO AL GRUPO DESTINO <<<
Tipo: Imagen + precios convertidos
Media tipo: image/jpeg
Caption enviado:
💰 Tomatodo Precio: S/ 31
💰 mochila Precio: S/ 76
================================
```

**Ejemplo 5: Múltiples productos con "y" y nombres**
```
=== MENSAJE RECIBIDO DEL GRUPO ORIGEN ===
Grupo: Compras grupales en 🇺🇸
Tiene imagen/media: true
Texto original: Set 16 y plato 18
=========================================

Set: Precio USD: $16 → +6.5% → +20% shopper → +15% ganancia → +$10 envío = $32.23 → S/ 110
plato: Precio USD: $18 → +6.5% → +20% shopper → +15% ganancia → +$10 envío = $34.76 → S/ 119

>>> ENVIADO AL GRUPO DESTINO <<<
Tipo: Imagen + precios convertidos
Media tipo: image/jpeg
Caption enviado:
💰 Set Precio: S/ 67
💰 plato Precio: S/ 76
================================
```

## ⚙️ Configuración

### Variables de Entorno (`.env`)

```env
# IDs de grupos de WhatsApp (formato: 120363089699450280@g.us)
GRUPO_ORIGEN_ID=120363089699450280@g.us
GRUPO_DESTINO_ID=120363406844528528@g.us

# Tipo de cambio
TIPO_CAMBIO_SOLES=3.40

# Fórmula de conversión (opcional)
PORCENTAJE_IMPUESTO=6.5
PORCENTAJE_SHOPPER=20
PORCENTAJE_GANANCIA=15
ENVIO_USD=10
```

### Cómo Obtener IDs de Grupos

1. Ejecutar: `npm run get-groups`
2. Escanear QR si es necesario
3. Se listarán todos los grupos con sus IDs
4. Copiar los IDs al archivo `.env`

## 🛠️ Tecnologías

- **Node.js** (≥18)
- **whatsapp-web.js** - Cliente de WhatsApp
- **Puppeteer** - Control de navegador para WhatsApp Web
- **dotenv** - Manejo de variables de entorno
- **qrcode-terminal** - Autenticación QR en terminal

## 📝 Scripts Disponibles

```bash
npm start          # Inicia el bot
npm run dev        # Modo desarrollo (auto-restart)
npm run get-groups # Lista IDs de grupos
```

## 🔐 Autenticación

- Primera ejecución: Se genera un QR en la terminal
- Escanear con WhatsApp (Dispositivos Vinculados)
- La sesión se guarda en `.wwebjs_auth/`
- Ejecuciones posteriores: Auto-login (no requiere QR)

## 🔍 Detección Inteligente de Precios

El bot utiliza algoritmos avanzados para detectar precios en múltiples formatos y **captura automáticamente el nombre de cada producto** para que tus clientes sepan exactamente qué están comprando.

### ✨ Captura Automática de Nombres

Cuando envías mensajes con múltiples productos, el bot es lo suficientemente inteligente como para extraer el nombre de cada uno:

| Mensaje Original | Lo que detecta el bot | Mensaje al Cliente |
|-----------------|----------------------|-------------------|
| `Tomatodo 6 (plástico) mochila 18` | "Tomatodo" → $6<br>"mochila" → $18 | 💰 Tomatodo Precio: S/ 31<br>💰 mochila Precio: S/ 76 |
| `Set 16 y plato 18` | "Set" → $16<br>"plato" → $18 | 💰 Set Precio: S/ 67<br>💰 plato Precio: S/ 76 |
| `Bowl 5.5 y vaso 7` | "Bowl" → $5.5<br>"vaso" → $7 | 💰 Bowl Precio: S/ 28<br>💰 vaso Precio: S/ 35 |

**Beneficio para tus clientes:** Ya no ven solo "💰 Precio: S/ 62" sin contexto. Ahora ven "💰 Tomatodo Precio: S/ 31" y saben exactamente de qué producto se trata.

### Prioridad de Detección

1. **Precios con `$`** (máxima prioridad)
   - `$28`, `28$`, `8$`, `$50`
   - Se marca automáticamente como conversión directa

2. **Precios en Soles** (`S/`)
   - `S/ 50`, `S/20`
   - No se convierte, se mantiene el valor

3. **Separadores especiales**
   - ` y ` → `16 y 18` → detecta 16 y 18
   - ` / ` → `color 78 / metal 84` → detecta ambos

4. **Formatos con nombre**
   - Número primero: `76 mochila` → precio 76, nombre "mochila"
   - Nombre primero: `Mochila 76` → precio 76, nombre "Mochila"

5. **Múltiples números en una línea con captura inteligente de nombres**
   - `Tomatodo 6 (plástico) mochila 18`
   - Detecta: precio 6 con nombre "Tomatodo", precio 18 con nombre "mochila"
   - Ignora palabras de cantidad como "pares", "unidades", "set", "pack"
   - **Resultado:** Cada precio se envía con su descripción específica

### Casos Especiales con Nombre Capturado

| Entrada | Precio Detectado | Nombre Capturado |
|---------|-----------------|------------------|
| `28$ entra laptop` | 28 | "entra laptop" |
| `4 pares 8$` | 8 | "4 pares" |
| `Pijamas 19` | 19 | "Pijamas" |
| `Medias 3.5 (1 par)` | 3.5 | "Medias" |
| `5.5 y 7 (taper)` | 5.5 y 7 | "taper" (ambos) |
| `Tomatodo 6 mochila 18` | 6 y 18 | "Tomatodo" y "mochila" |
| `Set 16 y plato 18` | 16 y 18 | "Set" y "plato" |

## 🎯 Casos Especiales

### Ejemplos de Mensajes Reales

#### Caso 1: Precios separados por "y" (sin nombres)
```
Entrada: 16 y 18
Salida:
💰 Precio: S/ 67
💰 Precio: S/ 76
```

#### Caso 2: Precios separados por "y" (con nombres)
```
Entrada: Tomatodo 5.5 y bowl 7
Salida:
💰 Tomatodo Precio: S/ 28
💰 bowl Precio: S/ 35
```

#### Caso 3: Precios decimales con "y" y descripción compartida
```
Entrada: 5.5 y 7 (taper)
Salida:
💰 taper Precio: S/ 28
💰 taper Precio: S/ 35
```

#### Caso 4: Múltiples productos en una línea
```
Entrada: Tomatodo 6 (plástico) mochila 18
Salida:
💰 Tomatodo Precio: S/ 31
💰 mochila Precio: S/ 76
```

#### Caso 5: Con signo $ (conversión directa)
```
Entrada: 4 pares 8$
Salida: 💰 Precio: S/ 28
```

#### Caso 6: Productos individuales con decimales
```
Entrada:
Pijamas 19
Medias 3.5 (1 par)

Salida:
💰 Pijamas Precio: S/ 80
💰 Medias Precio: S/ 18
```

### Mensajes con Múltiples Productos

**Sin signo `$` (fórmula completa):**
```
Entrada (grupo origen):
78 color entero / metálico 84
Mochila 76
Lonchera 27.99

Salida (grupo destino):
💰 color entero Precio: S/ 330
💰 metálico Precio: S/ 355
💰 Mochila Precio: S/ 429
💰 Lonchera Precio: S/ 118
```

**Con signo `$` (conversión directa):**
```
Entrada (grupo origen):
$28 mochila
30$ lonchera

Salida (grupo destino):
💰 mochila Precio: S/ 96
💰 lonchera Precio: S/ 102
```

### Precios Ya en Soles

Si el mensaje incluye `S/ 50`, el bot detecta que ya está en soles y **no aplica conversión**:

```
Entrada: S/ 50
Salida: 💰 Precio: S/ 50
```

## 🖥️ Despliegue en servidor Linux (Google Cloud VM, etc.)

El bot usa Puppeteer/Chromium para WhatsApp Web. En una VM Linux hay que **instalar Chromium** (o Chrome):

### Debian / Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y chromium-browser
```

Si el paquete se llama distinto en tu distro:

```bash
sudo apt-get install -y chromium
```

### Si Chromium está en otra ruta

El código busca en este orden: `chromium-browser`, `chromium`, `google-chrome`, `google-chrome-stable`. Si tu instalación está en otra ruta, define la variable de entorno antes de iniciar:

```bash
export CHROME_PATH=/ruta/al/chromium
npm start
```

O en `.env` (si la cargas antes de arrancar):

```
CHROME_PATH=/usr/bin/chromium
```

### Dependencias recomendadas (headless)

En algunos entornos minimalistas puede hacer falta:

```bash
sudo apt-get install -y libnss3 libatk1.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2
```

## 🐛 Manejo de Errores

- **SingletonLock**: El bot elimina automáticamente bloqueos de Chromium al iniciar
- **Timeouts**: 90 segundos para autenticación (servidores lentos)
- **Reintentos**: Hasta 5 intentos con delay de 8s si falla la inicialización
- **Media**: Si falla la descarga de imagen, envía solo el texto
- **Chats no soportados**: Ignora canales/newsletters sin llamar `getChat` (evita el error `r` de wwebjs 1.34.x)
- **Rastreo**: Si falla subir la foto al grupo de rastreo, envía solo el texto con la conversión
- **Librería**: Requiere `whatsapp-web.js` ≥ 1.34.7 (compatible con WhatsApp Web 2.3000.x)

## 📌 Notas Importantes

- El bot **solo procesa mensajes de grupos** (ignora chats privados)
- Solo reenvía mensajes del **GRUPO_ORIGEN** configurado
- Si no están configurados los grupos, solo muestra IDs en consola
- Los precios en Soles siempre se redondean **hacia arriba** (sin decimales)
- El formato del emoji 💰 se agrega automáticamente a los precios convertidos
