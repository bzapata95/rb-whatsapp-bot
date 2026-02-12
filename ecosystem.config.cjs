/**
 * Configuración PM2 para rb-whatsapp (Droplet DO, etc.)
 * Uso: desde la carpeta del proyecto → pm2 start ecosystem.config.cjs
 */

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'rb-whatsapp',
      script: 'src/index.js',
      cwd: path.resolve(__dirname),
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      // Logs
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
