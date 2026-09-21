/**
 * Camada de rede.
 *
 * Além do fetch normal, mantem uma "outbox": se o celular perder o sinal no
 * meio do supermercado, as alterações ficam guardadas e sobem sozinhas quando
 * a conexão volta. Ids temporarios de itens criados offline são trocados pelos
 * ids reais assim que o servidor responde.
 */

const OUTBOX_KEY = 'sl_outbox_v1';
const CLIENT_KEY = 'sl_client_id';

export const clientId = (() => {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
})();

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('Sem conexão com o servidor.');
    this.name = 'OfflineError';
  }
}

function load() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(queue) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  } catch {
    // armazenamento cheio ou modo privado: seguimos sem fila persistida
  }
}

export const outbox = {
  queue: load(),
  idMap: {},
  listeners: new Set(),

  get size() {
    return this.queue.length;
  },

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  notify() {
    for (const fn of this.listeners) fn(this.size);
  },

  push(entry) {
    this.queue.push(entry);
    save(this.queue);
    this.notify();
  },

  clear() {
    this.queue = [];
    save(this.queue);
    this.notify();
  },

  resolveId(id) {
    return this.idMap[id] || id;
  },
};

async function rawRequest(method, path, body, { signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-client-id': clientId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch {
    throw new OfflineError();
  }

  let data = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new ApiError(data?.error || `Erro ${response.status}`, response.status);
  }
  return data ?? {};
}

export function get(path, options) {
  return rawRequest('GET', path, undefined, options);
}

/**
 * Mutacao com suporte a offline.
 * @param {object} options
 * @param {boolean} options.queue guarda na outbox se a rede falhar
 * @param {string}  options.tempId id local do item criado offline
 */
export async function mutate(method, path, body, { queue = true, tempId = null } = {}) {
  try {
    return await rawRequest(method, path, body);
  } catch (error) {
    if (error instanceof OfflineError && queue) {
      outbox.push({ id: crypto.randomUUID(), method, path, body, tempId, at: Date.now() });
      return { queued: true };
    }
    throw error;
  }
}

export const post = (path, body, options) => mutate('POST', path, body, options);
export const patch = (path, body, options) => mutate('PATCH', path, body, options);
export const del = (path, options) => mutate('DELETE', path, undefined, options);

let flushing = false;

/**
 * Envia a fila na ordem. Para no primeiro erro de rede (tenta de novo depois);
 * descarta entradas rejeitadas pelo servidor para a fila não travar para sempre.
 * @returns {Promise<{sent:number, failed:number, remaining:number}>}
 */
export async function flushOutbox() {
  if (flushing || outbox.queue.length === 0) {
    return { sent: 0, failed: 0, remaining: outbox.queue.length };
  }
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    while (outbox.queue.length > 0) {
      const entry = outbox.queue[0];
      const path = rewrite(entry.path);
      if (path === null) {
        // Depende de um item que nunca chegou ao servidor: descarta.
        outbox.queue.shift();
        save(outbox.queue);
        failed += 1;
        continue;
      }
      try {
        const result = await rawRequest(entry.method, path, entry.body);
        if (entry.tempId && result?.items?.[0]?.id) {
          outbox.idMap[entry.tempId] = result.items[0].id;
        }
        outbox.queue.shift();
        save(outbox.queue);
        sent += 1;
      } catch (error) {
        if (error instanceof OfflineError) break; // ainda sem rede
        outbox.queue.shift(); // 4xx: pedido inválido, não adianta insistir
        save(outbox.queue);
        failed += 1;
      }
    }
  } finally {
    flushing = false;
    outbox.notify();
  }
  return { sent, failed, remaining: outbox.queue.length };
}

/**
 * Troca ids temporarios pelo id real que o servidor devolveu.
 * @returns {string|null} null quando o item referenciado nunca chegou ao servidor.
 */
function rewrite(path) {
  let unresolved = false;
  const result = path.replace(/tmp_[a-z0-9]+/gi, (tempId) => {
    const real = outbox.idMap[tempId];
    if (!real) unresolved = true;
    return real ?? tempId;
  });
  return unresolved ? null : result;
}

export { rewrite as rewritePath };
