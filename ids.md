# IDs de grupos WhatsApp

## Origen / referencia

| Grupo | ID |
|-------|-----|
| FOUNDCHEESE - STOCK 🚨 | `120363403061146426@g.us` |
| GASTOS CASA 💍 | `120363404527181585@g.us` |
| R & B International Imports 🇱🇷✈️ | `120363406844528528@g.us` |
| BOT TO | `120363423509617097@g.us` |
| BOT FROM | `120363425384499883@g.us` |
| ORIGINAL Compras grupales en 🇺🇸 | `120363424705639545@g.us` |

> Copia el ID en `.env` como `GRUPO_ORIGEN_ID` o `GRUPO_DESTINO_ID` y reinicia el bot.

---

## Destinations

| Grupo | ID |
|-------|-----|
| Compras grupales en 🇺🇸 | `120363089699450280@g.us` |
| GASTOS CASA 💍 | `120363404527181585@g.us` |

---

# Instalar Chrome estable

**Problema:** instalar Google Chrome estable `.deb`

## 1. Instalar en el servidor

```bash
cd /tmp

wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb

sudo apt update
sudo apt install -y ./google-chrome-stable_current_amd64.deb
```

## 2. Verificar instalación

```bash
which google-chrome-stable
google-chrome-stable --version
```

Debe salir algo como:

```
/usr/bin/google-chrome-stable
Google Chrome xxx.xxx.xxx
```

## 3. Actualizar `ecosystem.config.cjs`

Cambia el bloque `env` así:

```js
env: {
  NODE_ENV: 'production',
  CHROME_PATH: '/usr/bin/google-chrome-stable',
  PUPPETEER_EXECUTABLE_PATH: '/usr/bin/google-chrome-stable',
},
```

## 4. Reiniciar con PM2

```bash
cd ~/app/rb-whatsapp-bot

pm2 delete rb-whatsapp
pm2 start ecosystem.config.cjs --only rb-whatsapp --update-env
pm2 save
pm2 reset rb-whatsapp
```

## 5. Revisar logs

```bash
pm2 logs rb-whatsapp --lines 100
```

## 6. Confirmar que PM2 usa Chrome

```bash
pm2 show rb-whatsapp | grep -i chrome
# o
pm2 env rb-whatsapp | grep -i chrome
```

> **Opcional:** puedes dejar Chromium Snap instalado, pero ya no debería usarse si fuerzas `CHROME_PATH`.
