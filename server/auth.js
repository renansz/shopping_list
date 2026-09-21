import crypto from 'node:crypto';

const COOKIE_NAME = 'sl_session';

// Chrome (e outros navegadores modernos) recusam Max-Age acima de 400 dias
// em qualquer cookie - e o valor mais alto que da para pedir. A sessao em si
// nao expira (so por logout ou revogacao, ver server/sessions.js); o cookie
// e renovado a cada visita, entao esse teto nunca aparece na pratica para
// quem usa o app com alguma regularidade.
const COOKIE_MAX_AGE_DAYS = 400;

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

export function sessionCookie(sessionId, { secure }) {
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  const flags = ['Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) flags.push('Secure');
  return `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; ${flags.join('; ')}`;
}

export function clearCookie({ secure }) {
  const flags = ['Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (secure) flags.push('Secure');
  return `${COOKIE_NAME}=; ${flags.join('; ')}`;
}

export { COOKIE_NAME };

/** Limitador simples de tentativas de login/convite, por IP, em memória. */
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
