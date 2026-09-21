import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  {
    name: '001-inicial',
    up(db) {
      db.exec(`
        CREATE TABLE lists (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'open',
          is_current  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL,
          finished_at TEXT,
          created_by  TEXT,
          finished_by TEXT
        );

        CREATE TABLE items (
          id          TEXT PRIMARY KEY,
          list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          qty         TEXT NOT NULL DEFAULT '',
          url         TEXT NOT NULL DEFAULT '',
          note        TEXT NOT NULL DEFAULT '',
          checked     INTEGER NOT NULL DEFAULT 0,
          position    REAL NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL,
          checked_at  TEXT,
          created_by  TEXT,
          checked_by  TEXT
        );

        CREATE INDEX idx_items_list ON items (list_id, position);
        CREATE INDEX idx_items_name ON items (name);
        CREATE INDEX idx_lists_status ON lists (status, is_current, created_at DESC);

        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    // Sessao deixa de ser um cookie assinado com prazo fixo e passa a ser um
    // registro no banco: assim da para revogar um aparelho especifico sem
    // deslogar a casa inteira, e a sessao nao expira sozinha.
    name: '002-sessoes-e-convites',
    up(db) {
      db.exec(`
        CREATE TABLE invites (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          created_by  TEXT,
          created_at  TEXT NOT NULL,
          expires_at  TEXT NOT NULL,
          used_at     TEXT,
          revoked_at  TEXT
        );

        CREATE TABLE sessions (
          id           TEXT PRIMARY KEY,
          user_name    TEXT NOT NULL,
          created_via  TEXT NOT NULL DEFAULT 'password',
          invite_id    TEXT REFERENCES invites(id),
          created_at   TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          revoked_at   TEXT,
          revoked_reason TEXT
        );

        CREATE INDEX idx_sessions_revoked ON sessions (revoked_at);
      `);
    },
  },
];

export function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  // WAL deixa leitura e escrita simultaneas confortaveis numa VPS pequena.
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);
  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((row) => row.name),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migração ${migration.name}: ${error.message}`, { cause: error });
    }
  }
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
