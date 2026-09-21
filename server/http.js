import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_BODY = 1024 * 1024; // 1 MB já e folgado para uma lista de compras

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

export async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Corpo da requisição muito grande.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      const error = new Error('JSON inválido.');
      error.status = 400;
      throw error;
    }
    return parsed;
  } catch (error) {
    if (error.status) throw error;
    const parseError = new Error('JSON inválido.');
    parseError.status = 400;
    throw parseError;
  }
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

export function isSecureRequest(req, trustProxy) {
  if (req.socket?.encrypted) return true;
  if (!trustProxy) return false;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
}

/**
 * Defesa contra CSRF: com SameSite=Lax o navegador já bloqueia POST cross-site,
 * mas conferir a origem cobre clientes/navegadores antigos.
 */
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // apps nativos e curl não mandam Origin
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------- estáticos ---- */

export function createStaticHandler(rootDir) {
  const root = path.resolve(rootDir);
  const etags = new Map();

  function etagFor(file, stat) {
    const key = `${file}:${stat.mtimeMs}:${stat.size}`;
    let tag = etags.get(key);
    if (!tag) {
      tag = `W/"${crypto.createHash('sha1').update(key).digest('base64url')}"`;
      etags.set(key, tag);
    }
    return tag;
  }

  return async function serveStatic(req, res, urlPath) {
    let relative = decodeURIComponent(urlPath);
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.join(root, relative);
    if (!file.startsWith(root + path.sep) && file !== root) {
      sendText(res, 403, 'Acesso negado');
      return true;
    }
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch {
      return false;
    }
    if (stat.isDirectory()) return false;

    const ext = path.extname(file).toLowerCase();
    const etag = etagFor(file, stat);
    // O app shell precisa revalidar sempre; imagens podem ficar em cache longo.
    const immutable = ext === '.png' || ext === '.svg' || ext === '.woff2';
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=604800' : 'no-cache',
      etag,
      'last-modified': stat.mtime.toUTCString(),
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    headers['content-length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(file);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
    return true;
  };
}

/* ------------------------------------------------------------ router ---- */

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      `^${pattern
        .split('/')
        .map((segment) => {
          if (segment.startsWith(':')) {
            keys.push(segment.slice(1));
            return '([^/]+)';
          }
          return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/')}$`,
    );
    this.routes.push({ method, regex, keys, handler });
    return this;
  }

  get(pattern, handler) { return this.add('GET', pattern, handler); }
  post(pattern, handler) { return this.add('POST', pattern, handler); }
  patch(pattern, handler) { return this.add('PATCH', pattern, handler); }
  put(pattern, handler) { return this.add('PUT', pattern, handler); }
  delete(pattern, handler) { return this.add('DELETE', pattern, handler); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(found[index + 1]);
      });
      return { handler: route.handler, params };
    }
    return pathMatched ? { methodMismatch: true } : null;
  }
}
