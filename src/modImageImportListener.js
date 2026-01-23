const http = require('http');
const { URL } = require('url');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 28188;
const MAX_BODY_BYTES = 256 * 1024;

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (buf) => {
      total += buf.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'));
        try {
          req.destroy();
        } catch {
          // ignore
        }
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function extractPathFromBody(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  // Prefer JSON { path: "..." }
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      const p = obj.path ?? obj.filePath ?? obj.file ?? obj.value;
      if (p !== undefined && p !== null) return String(p).trim();
    }
  } catch {
    // ignore
  }

  // Fallback: treat body as plain path
  return text;
}

function startModImageImportListener(options) {
  const host = (options && options.host) || DEFAULT_HOST;
  const port = (options && options.port) || DEFAULT_PORT;
  const onImport = options && typeof options.onImport === 'function' ? options.onImport : null;

  const server = http.createServer(async (req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const urlObj = new URL(req.url || '/', `http://${host}:${port}`);

      if (urlObj.pathname !== '/pc/gallery/import') {
        sendJson(res, 404, { ok: false, error: 'not_found' });
        return;
      }

      let filePath = '';
      if (method === 'GET') {
        filePath = String(urlObj.searchParams.get('path') || '').trim();
      } else if (method === 'POST') {
        const raw = await readRequestBody(req);
        filePath = extractPathFromBody(raw);
      } else {
        sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }

      if (!filePath) {
        sendJson(res, 400, { ok: false, error: 'missing_path' });
        return;
      }

      if (onImport) {
        try {
          onImport(filePath);
        } catch (e) {
          // Do not fail the HTTP request if UI automation fails.
        }
      }

      sendJson(res, 200, { ok: true });
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : 'internal_error';
      sendJson(res, 500, { ok: false, error: msg });
    }
  });

  server.listen(port, host);

  return {
    host,
    port,
    close: () => {
      try {
        server.close();
      } catch {
        // ignore
      }
    }
  };
}

module.exports = {
  startModImageImportListener,
  DEFAULT_HOST,
  DEFAULT_PORT
};
