const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function startLocalWebServer({ publicDir, host = '127.0.0.1', port = 0, getConfig }) {
  if (!publicDir) throw new Error('publicDir is required');

  const resolvedPublicDir = path.resolve(publicDir);

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}`);
      const pathname = safeDecodeURIComponent(url.pathname || '/');

      if (pathname === '/config') {
        const conf = typeof getConfig === 'function' ? getConfig() : {};
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(conf || {}));
        return;
      }

      let relPath = pathname;
      if (relPath === '/' || !relPath) relPath = '/index.html';

      // Prevent path traversal.
      const candidatePath = path.resolve(resolvedPublicDir, '.' + relPath);
      if (!candidatePath.startsWith(resolvedPublicDir + path.sep) && candidatePath !== resolvedPublicDir) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Forbidden');
        return;
      }

      let filePath = candidatePath;
      try {
        const st = fs.statSync(filePath);
        if (st.isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
      } catch {
        // ignore
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Not Found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');

        // Reasonable caching: HTML no-cache; others long cache (Electron also enforces extra headers).
        if (ext === '.html') res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

        res.end(data);
      });
    } catch {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Internal Server Error');
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const baseUrl = `http://${host}:${actualPort}/`;
      resolve({
        host,
        port: actualPort,
        baseUrl,
        close: () => {
          try {
            server.close();
          } catch {
            // ignore
          }
        }
      });
    });
  });
}

module.exports = {
  startLocalWebServer
};
