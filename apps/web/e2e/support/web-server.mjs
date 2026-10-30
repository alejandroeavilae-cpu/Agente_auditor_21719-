// SPDX-License-Identifier: AGPL-3.0-or-later
// Servidor de la SPA compilada para las pruebas E2E, sin dependencias.
//
// Imita lo que hace Caddy en el perfil local (deploy/docker/Caddyfile): sirve apps/web/dist
// con respaldo a index.html, reenvía /api y /health a la API, y aplica EXACTAMENTE las
// cabeceras de seguridad del Caddyfile, que se leen de ese archivo en cada arranque (si
// alguien cambia la CSP en Caddy, las pruebas usan la nueva; si no se puede leer, falla).
// Así las pruebas E2E detectan cualquier estilo o script en línea que la CSP bloquearía.
//
// Uso: node web-server.mjs <puerto> <url-api> <dir-dist> <caddyfile>
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { URL } from 'node:url';

const [port, apiUrl, distDir, caddyfile] = process.argv.slice(2);
if (!port || !apiUrl || !distDir || !caddyfile) {
  console.error('Uso: node web-server.mjs <puerto> <url-api> <dir-dist> <caddyfile>');
  process.exit(2);
}

/** Lee el bloque `header { ... }` del Caddyfile: "Nombre "valor"" y "-Nombre" (quitar). */
export function headersFromCaddyfile(text) {
  const block = /header\s*\{([\s\S]*?)\n\s*\}/.exec(text);
  if (block === null) throw new Error('No se encontró el bloque header en el Caddyfile');
  const headers = {};
  for (const raw of block[1].split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('-')) continue;
    const m = /^([A-Za-z-]+)\s+"(.*)"$/.exec(line);
    if (m === null) throw new Error(`Línea de cabecera no reconocida en el Caddyfile: ${line}`);
    headers[m[1]] = m[2];
  }
  if (!headers['Content-Security-Policy']) throw new Error('El Caddyfile no define Content-Security-Policy');
  return headers;
}

const SECURITY_HEADERS = headersFromCaddyfile(readFileSync(caddyfile, 'utf8'));
const ROOT = resolve(distDir);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};
const api = new URL(apiUrl);

function serveFile(res, file) {
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    const upstream = request(
      { host: api.hostname, port: api.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${api.hostname}:${api.port}` } },
      (up) => {
        // Caddy agrega sus cabeceras también a las respuestas de la API.
        res.writeHead(up.statusCode ?? 502, { ...up.headers, ...SECURITY_HEADERS });
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('API no disponible');
    });
    req.pipe(upstream);
    return;
  }
  // Archivos estáticos dentro de dist; cualquier otra ruta, index.html (try_files de Caddy).
  const candidate = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (candidate.startsWith(ROOT)) {
    try {
      if (statSync(candidate).isFile()) return serveFile(res, candidate);
    } catch {
      // No existe: se sirve la SPA.
    }
  }
  return serveFile(res, join(ROOT, 'index.html'));
});

server.listen(Number(port), '127.0.0.1', () => {
  console.log(`web-e2e escuchando en http://127.0.0.1:${port} (API ${apiUrl})`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
