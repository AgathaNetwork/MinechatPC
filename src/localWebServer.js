const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
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

      // Simple CORS preflight compatibility (some browsers still send it even on same-origin).
      if ((req.method || '').toUpperCase() === 'OPTIONS') {
        res.statusCode = 204;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', String(req.headers['access-control-request-headers'] || '*'));
        res.setHeader('Access-Control-Max-Age', '600');
        res.end();
        return;
      }

      // Reverse proxy: /api/* -> <apiBase>/*
      // This avoids CORS issues when the UI is served from http://127.0.0.1:<port>.
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const conf = typeof getConfig === 'function' ? getConfig() : {};
        const apiBase = conf && conf.apiBase ? String(conf.apiBase) : '';
        if (!apiBase) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'apiBase_not_configured' }));
          return;
        }

        const targetBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
        const stripPrefix = pathname === '/api' ? '' : pathname.slice('/api'.length);
        const targetUrl = new URL(stripPrefix + (url.search || ''), targetBase + '/');

        const isHttps = targetUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const headers = { ...(req.headers || {}) };
        // Hop-by-hop headers should not be forwarded.
        delete headers['connection'];
        delete headers['proxy-connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];
        delete headers['upgrade'];

        // Update Host/Origin/Referer for backend.
        headers['host'] = targetUrl.host;
        try {
          if (headers['origin']) headers['origin'] = targetUrl.origin;
        } catch {}
        try {
          if (headers['referer']) {
            const r = new URL(String(headers['referer']));
            headers['referer'] = targetUrl.origin + r.pathname + (r.search || '');
          }
        } catch {}

        const proxyReq = client.request(
          {
            protocol: targetUrl.protocol,
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            method: req.method,
            path: targetUrl.pathname + targetUrl.search,
            headers
          },
          (proxyRes) => {
            res.statusCode = proxyRes.statusCode || 502;

            // Copy headers back, but keep it safe.
            const respHeaders = { ...(proxyRes.headers || {}) };
            delete respHeaders['content-security-policy'];
            delete respHeaders['content-security-policy-report-only'];
            // Ensure browser treats this as local response.
            respHeaders['access-control-allow-origin'] = '*';
            Object.entries(respHeaders).forEach(([k, v]) => {
              try {
                if (typeof v !== 'undefined') res.setHeader(k, v);
              } catch {
                // ignore invalid header
              }
            });

            proxyRes.pipe(res);
          }
        );

        proxyReq.on('error', () => {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }
          try {
            res.end(JSON.stringify({ error: 'proxy_error' }));
          } catch {
            // ignore
          }
        });

        req.pipe(proxyReq);
        return;
      }

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

  // WebSocket upgrade proxy for /api/* (socket.io uses it for websocket transport).
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url || '/', `http://${host}`);
      const pathname = safeDecodeURIComponent(url.pathname || '/');
      if (!(pathname === '/api' || pathname.startsWith('/api/'))) {
        try { socket.destroy(); } catch {}
        return;
      }

      const conf = typeof getConfig === 'function' ? getConfig() : {};
      const apiBase = conf && conf.apiBase ? String(conf.apiBase) : '';
      if (!apiBase) {
        try {
          socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
        } catch {}
        try { socket.destroy(); } catch {}
        return;
      }

      const targetBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
      const stripPrefix = pathname === '/api' ? '' : pathname.slice('/api'.length);
      const targetUrl = new URL(stripPrefix + (url.search || ''), targetBase + '/');

      const isHttps = targetUrl.protocol === 'https:';
      const port = Number(targetUrl.port || (isHttps ? 443 : 80));

      const connectOpts = {
        host: targetUrl.hostname,
        port,
        servername: targetUrl.hostname
      };

      const upstream = isHttps ? tls.connect(connectOpts) : net.connect(connectOpts);

      const onError = () => {
        try { socket.destroy(); } catch {}
        try { upstream.destroy(); } catch {}
      };

      upstream.on('error', onError);
      socket.on('error', onError);

      const readyEvent = isHttps ? 'secureConnect' : 'connect';
      upstream.on(readyEvent, () => {
        try {
          // Reconstruct raw HTTP upgrade request.
          const headers = { ...(req.headers || {}) };
          headers.host = targetUrl.host;

          let headerLines = '';
          for (const [k, v] of Object.entries(headers)) {
            if (typeof v === 'undefined') continue;
            if (Array.isArray(v)) {
              for (const vv of v) headerLines += `${k}: ${vv}\r\n`;
            } else {
              headerLines += `${k}: ${v}\r\n`;
            }
          }

          const requestLine = `${req.method || 'GET'} ${targetUrl.pathname + targetUrl.search} HTTP/1.1\r\n`;
          upstream.write(requestLine + headerLines + '\r\n');
          if (head && head.length) upstream.write(head);

          // Bi-directional piping.
          socket.pipe(upstream);
          upstream.pipe(socket);
        } catch {
          onError();
        }
      });
    } catch {
      try { socket.destroy(); } catch {}
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
