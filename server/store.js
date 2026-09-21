import { newId } from './ids.js';

const MAX_TEXT = 400;
const MAX_NOTE = 2000;

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

function now() {
  return new Date().toISOString();
}

function clean(value, max = MAX_TEXT) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanMultiline(value, max = MAX_NOTE) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

// Aceita apenas http/https para não virar vetor de javascript: em link clicavel.
export function normalizeUrl(value) {
  const raw = clean(value, 2000);
  if (!raw) return '';
  // Sem esquema assumimos https; com esquema, só http(s) passa.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new ValidationError('Link inválido.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('Use um link http ou https.');
  }
  return parsed.toString();
}

export function defaultListName(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `Compras de ${day}/${month}`;
}

export class Store {
  constructor(db) {
    this.db = db;
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // rollback em transação já encerrada não deve mascarar o erro original
      }
      throw error;
    }
  }

  /* ---------------------------------------------------------- listas ---- */

  rawList(id) {
    return this.db.prepare('SELECT * FROM lists WHERE id = ?').get(id) || null;
  }

  getList(id) {
    const row = this.rawList(id);
    return row ? this.#decorate(row) : null;
  }

  requireList(id) {
    const list = this.rawList(id);
    if (!list) throw new ValidationError('Lista não encontrada.', 404);
    return list;
  }

  requireOpenList(id) {
    const list = this.requireList(id);
    if (list.status !== 'open') {
      throw new ValidationError('Esta lista já foi finalizada. Reabra antes de editar.', 409);
    }
    return list;
  }

  // Garante a regra do produto: sempre existe uma lista "atual" aberta.
  ensureCurrentList(author = null) {
    const current = this.db
      .prepare("SELECT * FROM lists WHERE is_current = 1 AND status = 'open' LIMIT 1")
      .get();
    if (current) return this.#decorate(current);

    const promoted = this.db
      .prepare("SELECT * FROM lists WHERE status = 'open' ORDER BY created_at DESC LIMIT 1")
      .get();
    if (promoted) {
      this.db.prepare('UPDATE lists SET is_current = 0 WHERE is_current = 1').run();
      this.db.prepare('UPDATE lists SET is_current = 1, updated_at = ? WHERE id = ?').run(now(), promoted.id);
      return this.getList(promoted.id);
    }
    return this.createList({ name: defaultListName(), author, makeCurrent: true });
  }

  getCurrentList(author = null) {
    return this.ensureCurrentList(author);
  }

  createList({ name, author = null, makeCurrent = false } = {}) {
    const given = clean(name);
    // Nome automático ganha sufixo para não existirem duas "Compras de 21/09".
    const listName = given || this.#uniqueName(defaultListName());
    const id = newId('l_');
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO lists (id, name, status, is_current, created_at, updated_at, created_by)
         VALUES (?, ?, 'open', 0, ?, ?, ?)`,
      )
      .run(id, listName, ts, ts, author);
    if (makeCurrent) this.setCurrentList(id);
    return this.getList(id);
  }

  #uniqueName(base) {
    const taken = new Set(
      this.db.prepare('SELECT name FROM lists WHERE name = ? OR name LIKE ?').all(base, `${base} (%`).map((r) => r.name),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; n < 500; n += 1) {
      const candidate = `${base} (${n})`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base} (${Date.now()})`;
  }

  renameList(id, name) {
    const list = this.requireList(id);
    const listName = clean(name);
    if (!listName) throw new ValidationError('O nome da lista não pode ficar vazio.');
    this.db.prepare('UPDATE lists SET name = ?, updated_at = ? WHERE id = ?').run(listName, now(), list.id);
    return this.getList(id);
  }

  setCurrentList(id) {
    const list = this.requireOpenList(id);
    this.db.prepare('UPDATE lists SET is_current = 0 WHERE is_current = 1 AND id != ?').run(list.id);
    this.db.prepare('UPDATE lists SET is_current = 1, updated_at = ? WHERE id = ?').run(now(), list.id);
    return this.getList(id);
  }

  /**
   * Finaliza a lista. Se ela era a atual, uma nova lista atual entra no lugar
   * para que a tela inicial nunca fique sem lista.
   * @param {object} options
   * @param {boolean} options.carryOver copia os itens não comprados para a próxima lista
   */
  finishList(id, { author = null, carryOver = true, nextName = '' } = {}) {
    return this.transaction(() => {
      const list = this.requireList(id);
      if (list.status === 'finished') {
        throw new ValidationError('Esta lista já foi finalizada.', 409);
      }
      const ts = now();
      this.db
        .prepare(
          `UPDATE lists SET status = 'finished', is_current = 0, finished_at = ?, finished_by = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(ts, author, ts, list.id);

      let next = null;
      if (list.is_current) {
        next = this.createList({ name: clean(nextName), author, makeCurrent: true });
        if (carryOver) this.#copyPendingItems(list.id, next.id, author);
      }
      return { finished: this.getList(list.id), current: next ? this.getList(next.id) : this.ensureCurrentList(author) };
    });
  }

  reopenList(id, { makeCurrent = false, author = null } = {}) {
    return this.transaction(() => {
      const list = this.requireList(id);
      if (list.status === 'open') throw new ValidationError('Esta lista já está aberta.', 409);
      const ts = now();
      this.db
        .prepare("UPDATE lists SET status = 'open', finished_at = NULL, finished_by = NULL, updated_at = ? WHERE id = ?")
        .run(ts, list.id);
      if (makeCurrent) this.setCurrentList(list.id);
      return { list: this.getList(list.id), current: this.ensureCurrentList(author) };
    });
  }

  deleteList(id, { author = null } = {}) {
    return this.transaction(() => {
      const list = this.requireList(id);
      this.db.prepare('DELETE FROM lists WHERE id = ?').run(list.id);
      return { deletedId: list.id, current: this.ensureCurrentList(author) };
    });
  }

  #copyPendingItems(fromListId, toListId, author) {
    const pending = this.db
      .prepare('SELECT * FROM items WHERE list_id = ? AND checked = 0 ORDER BY position ASC, created_at ASC')
      .all(fromListId);
    const ts = now();
    let position = 0;
    const insert = this.db.prepare(
      `INSERT INTO items (id, list_id, name, qty, url, note, checked, position, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    );
    for (const item of pending) {
      position += 1;
      insert.run(newId('i_'), toListId, item.name, item.qty, item.url, item.note, position, ts, ts, author || item.created_by);
    }
    return pending.length;
  }

  listSummaries({ status = 'open', limit = 100, offset = 0 } = {}) {
    const where = status === 'all' ? '' : 'WHERE l.status = ?';
    const params = status === 'all' ? [] : [status];
    const rows = this.db
      .prepare(
        `SELECT l.*,
                (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS total_items,
                (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id AND i.checked = 1) AS checked_items
         FROM lists l
         ${where}
         ORDER BY l.is_current DESC,
                  CASE WHEN l.status = 'open' THEN l.updated_at ELSE l.finished_at END DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0));
    return rows.map((row) => this.#decorate(row));
  }

  countLists(status = 'all') {
    const row =
      status === 'all'
        ? this.db.prepare('SELECT COUNT(*) AS n FROM lists').get()
        : this.db.prepare('SELECT COUNT(*) AS n FROM lists WHERE status = ?').get(status);
    return row.n;
  }

  listWithItems(id) {
    const list = this.getList(id);
    if (!list) return null;
    list.items = this.items(id);
    return list;
  }

  #decorate(row) {
    const total = row.total_items ?? this.#countItems(row.id);
    const checked = row.checked_items ?? this.#countItems(row.id, true);
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      isCurrent: Boolean(row.is_current),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      createdBy: row.created_by,
      finishedBy: row.finished_by,
      totalItems: total,
      checkedItems: checked,
      pendingItems: total - checked,
    };
  }

  #countItems(listId, onlyChecked = false) {
    const sql = onlyChecked
      ? 'SELECT COUNT(*) AS n FROM items WHERE list_id = ? AND checked = 1'
      : 'SELECT COUNT(*) AS n FROM items WHERE list_id = ?';
    return this.db.prepare(sql).get(listId).n;
  }

  /* ----------------------------------------------------------- itens ---- */

  items(listId) {
    return this.db
      .prepare('SELECT * FROM items WHERE list_id = ? ORDER BY position ASC, created_at ASC')
      .all(listId)
      .map(itemToJson);
  }

  getItem(id) {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    return row ? itemToJson(row) : null;
  }

  requireItem(id) {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!row) throw new ValidationError('Item não encontrado.', 404);
    return row;
  }

  addItem(listId, { name, qty = '', url = '', note = '', author = null } = {}) {
    const list = this.requireOpenList(listId);
    const itemName = clean(name);
    if (!itemName) throw new ValidationError('Escreva o nome do item.');
    const ts = now();
    const position = this.#nextPosition(list.id);
    const id = newId('i_');
    this.db
      .prepare(
        `INSERT INTO items (id, list_id, name, qty, url, note, checked, position, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(id, list.id, itemName, clean(qty, 60), normalizeUrl(url), cleanMultiline(note), position, ts, ts, author);
    this.#touch(list.id);
    return this.getItem(id);
  }

  // Aceita várias linhas coladas de uma vez ("arroz\nfeijao\nleite").
  addItems(listId, lines, { author = null } = {}) {
    const list = this.requireOpenList(listId);
    const names = (Array.isArray(lines) ? lines : String(lines).split('\n'))
      .map((line) => clean(line))
      .filter(Boolean);
    if (names.length === 0) throw new ValidationError('Escreva ao menos um item.');
    return this.transaction(() => names.map((name) => this.addItem(list.id, { name, author })));
  }

  updateItem(id, patch = {}, { author = null } = {}) {
    const item = this.requireItem(id);
    this.requireOpenList(item.list_id);
    const fields = [];
    const values = [];

    if (patch.name !== undefined) {
      const name = clean(patch.name);
      if (!name) throw new ValidationError('O nome do item não pode ficar vazio.');
      fields.push('name = ?');
      values.push(name);
    }
    if (patch.qty !== undefined) {
      fields.push('qty = ?');
      values.push(clean(patch.qty, 60));
    }
    if (patch.url !== undefined) {
      fields.push('url = ?');
      values.push(normalizeUrl(patch.url));
    }
    if (patch.note !== undefined) {
      fields.push('note = ?');
      values.push(cleanMultiline(patch.note));
    }
    if (patch.checked !== undefined) {
      const checked = patch.checked ? 1 : 0;
      fields.push('checked = ?', 'checked_at = ?', 'checked_by = ?');
      values.push(checked, checked ? now() : null, checked ? author : null);
    }
    if (patch.position !== undefined) {
      const position = Number(patch.position);
      if (!Number.isFinite(position)) throw new ValidationError('Posição inválida.');
      fields.push('position = ?');
      values.push(position);
    }
    if (fields.length === 0) return itemToJson(item);

    fields.push('updated_at = ?');
    values.push(now(), item.id);
    this.db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    this.#touch(item.list_id);
    return this.getItem(item.id);
  }

  toggleItem(id, checked, { author = null } = {}) {
    return this.updateItem(id, { checked: Boolean(checked) }, { author });
  }

  deleteItem(id) {
    const item = this.requireItem(id);
    this.requireOpenList(item.list_id);
    this.db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
    this.#touch(item.list_id);
    return { deletedId: item.id, listId: item.list_id };
  }

  reorderItems(listId, orderedIds) {
    const list = this.requireOpenList(listId);
    if (!Array.isArray(orderedIds)) throw new ValidationError('Ordem inválida.');
    return this.transaction(() => {
      const update = this.db.prepare('UPDATE items SET position = ?, updated_at = ? WHERE id = ? AND list_id = ?');
      const ts = now();
      orderedIds.forEach((itemId, index) => update.run(index + 1, ts, itemId, list.id));
      this.#touch(list.id);
      return this.items(list.id);
    });
  }

  clearChecked(listId) {
    const list = this.requireOpenList(listId);
    const result = this.db.prepare('DELETE FROM items WHERE list_id = ? AND checked = 1').run(list.id);
    this.#touch(list.id);
    return { removed: Number(result.changes ?? 0) };
  }

  uncheckAll(listId) {
    const list = this.requireOpenList(listId);
    this.db
      .prepare('UPDATE items SET checked = 0, checked_at = NULL, checked_by = NULL, updated_at = ? WHERE list_id = ?')
      .run(now(), list.id);
    this.#touch(list.id);
    return this.items(list.id);
  }

  // Copia itens (todos ou só os pendentes) de uma lista para outra aberta.
  copyItems(fromListId, toListId, { onlyPending = true, author = null } = {}) {
    const from = this.requireList(fromListId);
    const to = this.requireOpenList(toListId);
    if (from.id === to.id) throw new ValidationError('Escolha uma lista de destino diferente.');
    return this.transaction(() => {
      const sql = onlyPending
        ? 'SELECT * FROM items WHERE list_id = ? AND checked = 0 ORDER BY position ASC'
        : 'SELECT * FROM items WHERE list_id = ? ORDER BY position ASC';
      const source = this.db.prepare(sql).all(from.id);
      const ts = now();
      let position = this.#nextPosition(to.id);
      const insert = this.db.prepare(
        `INSERT INTO items (id, list_id, name, qty, url, note, checked, position, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      );
      for (const item of source) {
        insert.run(newId('i_'), to.id, item.name, item.qty, item.url, item.note, position, ts, ts, author);
        position += 1;
      }
      this.#touch(to.id);
      return { copied: source.length, listId: to.id };
    });
  }

  #nextPosition(listId) {
    const row = this.db.prepare('SELECT MAX(position) AS max FROM items WHERE list_id = ?').get(listId);
    return (row?.max ?? 0) + 1;
  }

  #touch(listId) {
    this.db.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').run(now(), listId);
  }

  /* ------------------------------------------------------ sugestões ---- */

  // Autocomplete alimentado pelo próprio histórico da família.
  suggestions(query = '', limit = 8, excludeListId = null) {
    const term = clean(query).toLowerCase();
    const params = [];
    let where = '';
    if (term) {
      where = 'WHERE LOWER(name) LIKE ? ESCAPE \'\\\'';
      params.push(`%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
    }
    let excludeClause = '';
    if (excludeListId) {
      excludeClause = `${where ? 'AND' : 'WHERE'} name NOT IN (SELECT name FROM items WHERE list_id = ?)`;
      params.push(excludeListId);
    }
    params.push(Math.min(Math.max(limit, 1), 30));
    const rows = this.db
      .prepare(
        `SELECT name, COUNT(*) AS uses, MAX(created_at) AS last_used
         FROM items
         ${where} ${excludeClause}
         GROUP BY LOWER(name)
         ORDER BY uses DESC, last_used DESC
         LIMIT ?`,
      )
      .all(...params);
    return rows.map((row) => ({ name: row.name, uses: row.uses, lastUsed: row.last_used }));
  }

  stats() {
    const lists = this.db
      .prepare("SELECT COUNT(*) AS total, SUM(status = 'finished') AS finished FROM lists")
      .get();
    const items = this.db.prepare('SELECT COUNT(*) AS total FROM items').get();
    return {
      lists: lists.total,
      finishedLists: lists.finished ?? 0,
      items: items.total,
    };
  }
}

function itemToJson(row) {
  return {
    id: row.id,
    listId: row.list_id,
    name: row.name,
    qty: row.qty,
    url: row.url,
    note: row.note,
    checked: Boolean(row.checked),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checkedAt: row.checked_at,
    createdBy: row.created_by,
    checkedBy: row.checked_by,
  };
}
