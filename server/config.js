import path from 'node:path';
import fs from 'node:fs';

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function int(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

// Carrega um .env simples (KEY=VALUE) sem depender de pacote externo.
// Variáveis já presentes no ambiente tem prioridade.
export function loadDotEnv(file = '.env') {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function readConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || './data');
  const cookieSecureRaw = (env.COOKIE_SECURE || 'auto').toLowerCase();
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: env.DB_FILE ? path.resolve(env.DB_FILE) : path.join(dataDir, 'shopping.db'),
    password: env.HOUSEHOLD_PASSWORD || '',
    authDisabled: bool(env.AUTH_DISABLED, false),
    trustProxy: bool(env.TRUST_PROXY, false),
    cookieSecure: cookieSecureRaw === 'auto' ? 'auto' : bool(cookieSecureRaw, false),
    appName: env.APP_NAME || 'Lista de Compras',
  };
}
