import crypto from 'node:crypto';
import { ValidationError } from './store.js';

const CONVITE_VALIDADE_DIAS = 7;

function now() {
  return new Date().toISOString();
}

// Token de sessao e de convite sao segredos: 256 bits de aleatoriedade
// bastam por si so, sem precisar de assinatura HMAC por cima.
function newToken(prefix) {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

/**
 * Sessoes viram registro no banco (nao mais um cookie assinado com prazo
 * fixo): assim da para revogar um aparelho especifico sem deslogar a casa
 * inteira, e a sessao nao expira sozinha - so por logout ou revogacao.
 */
export class SessionStore {
  constructor(db) {
    this.db = db;
  }

  /* ------------------------------------------------------------ sessao --- */

  createSession(userName, { createdVia = 'password', inviteId = null } = {}) {
    const id = newToken('s_');
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_name, created_via, invite_id, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userName, createdVia, inviteId, ts, ts);
    return this.getSession(id);
  }

  getSession(id) {
    if (!id) return null;
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL')
      .get(id);
    return row ? sessionToJson(row) : null;
  }

  // Chamado a cada requisicao autenticada: mantem a sessao "viva" e da base
  // para o cookie ser renovado sem que o usuario perceba nada.
  touchSession(id) {
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), id);
  }

  listActive(excludeOlderThanDays = 400) {
    const limite = new Date(Date.now() - excludeOlderThanDays * 24 * 60 * 60 * 1000).toISOString();
    return this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE revoked_at IS NULL AND last_seen_at >= ?
         ORDER BY last_seen_at DESC`,
      )
      .all(limite)
      .map(sessionToJson);
  }

  revoke(id, reason = 'logout') {
    const result = this.db
      .prepare('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL')
      .run(now(), reason, id);
    return Number(result.changes ?? 0) > 0;
  }

  revokeAll(reason = 'reset geral') {
    const ts = now();
    const result = this.db
      .prepare('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE revoked_at IS NULL')
      .run(ts, reason);
    return Number(result.changes ?? 0);
  }

  /* ----------------------------------------------------------- convite --- */

  // Link nomeado de uso unico: quem ja tem acesso gera um para uma pessoa,
  // manda pelo WhatsApp/SMS, e a pessoa entra so de clicar - sem senha e
  // sem digitar o proprio nome.
  createInvite(name, { createdBy = null, validDays = CONVITE_VALIDADE_DIAS } = {}) {
    const cleanName = String(name ?? '').trim().slice(0, 40);
    if (!cleanName) throw new ValidationError('Diga o nome de quem vai usar o convite.');
    const id = newToken('inv_');
    const ts = now();
    const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString();
    this.db
      .prepare(
        `INSERT INTO invites (id, name, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, cleanName, createdBy, ts, expiresAt);
    return inviteToJson(this.rawInvite(id));
  }

  rawInvite(id) {
    return this.db.prepare('SELECT * FROM invites WHERE id = ?').get(id) || null;
  }

  // Leitura pura, nunca consome o convite. Precisa ser seguro contra bots de
  // previa (WhatsApp/Telegram buscam a URL sozinhos antes de alguem clicar) -
  // por isso abrir o link so mostra "Entrar como Fulano?"; consumir precisa
  // de um POST explicito, que so acontece com o app rodando e a pessoa
  // tocando no botao.
  getInvite(id) {
    const row = this.rawInvite(id);
    if (!row) return { valid: false, reason: 'Convite não encontrado.' };
    if (row.revoked_at) return { valid: false, reason: 'Este convite foi cancelado.' };
    if (row.used_at) return { valid: false, reason: 'Este convite já foi usado.' };
    if (row.expires_at < now()) return { valid: false, reason: 'Este convite expirou.' };
    return { valid: true, name: row.name };
  }

  // So aqui o convite e de fato gasto - e sempre por uma acao explicita da
  // pessoa (nunca pela simples abertura do link).
  consumeInvite(id) {
    return this.#transaction(() => {
      const preview = this.getInvite(id);
      if (!preview.valid) throw new ValidationError(preview.reason, 410);
      this.db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').run(now(), id);
      return this.createSession(preview.name, { createdVia: 'invite', inviteId: id });
    });
  }

  listInvites() {
    return this.db
      .prepare(
        `SELECT * FROM invites
         WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at >= ?
         ORDER BY created_at DESC`,
      )
      .all(now())
      .map(inviteToJson);
  }

  revokeInvite(id) {
    const result = this.db
      .prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL')
      .run(now(), id);
    return Number(result.changes ?? 0) > 0;
  }

  #transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // rollback em transacao ja encerrada nao deve mascarar o erro original
      }
      throw error;
    }
  }
}

function sessionToJson(row) {
  return {
    id: row.id,
    userName: row.user_name,
    createdVia: row.created_via,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function inviteToJson(row) {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
