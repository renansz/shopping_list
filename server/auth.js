import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const COOKIE_NAME = 'sl_session';

export function resolveSecret(db, configured) {
  if (configured) return configured;
  const stored = getSetting(db, 'session_secret');
  if (stored) return stored;
  const generated = crypto.randomBytes(32).toString('hex');
  setSetting(db, 'session_secret', generated);
  return generated;
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createToken(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const index = token.lastIndexOf('.');
  const body = token.slice(0, index);
  const signature = token.slice(index + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function checkPassword(given, expected) {
  // Compara hashes de tamanho fixo para o tempo de resposta não vazar a senha.
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(expected ?? '')).digest();
  return crypto.timingSafeEqual(a, b);
}

export function parseCookies(header = '') {
  const jar = {};
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      jar[key] = part.slice(eq + 1).trim();
    }
  }
  return jar;
}

export function sessionCookie(token, { secure, days }) {
  const maxAge = Math.max(days, 1) * 24 * 60 * 60;
  const flags = ['Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) flags.push('Secure');
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; ${flags.join('; ')}`;
}

export function clearCookie({ secure }) {
  const flags = ['Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (secure) flags.push('Secure');
  return `${COOKIE_NAME}=; ${flags.join('; ')}`;
}

export { COOKIE_NAME };

/** Limitador simples de tentativas de login, por IP, em memória. */
export class LoginThrottle {
  constructor({ max = 10, windowMs = 10 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  check(key) {
    const entry = this.hits.get(key);
    if (!entry) return true;
    if (Date.now() - entry.start > this.windowMs) {
      this.hits.delete(key);
      return true;
    }
    return entry.count < this.max;
  }

  fail(key) {
    const entry = this.hits.get(key);
    if (!entry || Date.now() - entry.start > this.windowMs) {
      this.hits.set(key, { start: Date.now(), count: 1 });
      return;
    }
    entry.count += 1;
  }

  reset(key) {
    this.hits.delete(key);
  }
}
