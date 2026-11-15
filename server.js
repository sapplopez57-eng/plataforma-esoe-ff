const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Cabeceras de seguridad basicas
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Solo se publican los recursos del cliente. Nunca la raiz del proyecto
// (server.js, .env, database/ y package.json no deben ser descargables).
app.use('/css', express.static(path.join(__dirname, 'css'), { dotfiles: 'deny' }));
app.use('/js', express.static(path.join(__dirname, 'js'), { dotfiles: 'deny' }));

// Endpoint de salud para monitoreo en Proxmox / Docker
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'ESOE-SMS-Platform',
    timestamp: new Date().toISOString()
  });
});

// Fallback SPA para navegacion web en cualquier dispositivo
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ESOE-SMS] Servidor web activo en http://0.0.0.0:${PORT}`);
});
