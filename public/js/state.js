/** Estado da aplicação no cliente, com snapshot local para abrir offline. */

const SNAPSHOT_KEY = 'sl_snapshot_v1';
const PREFS_KEY = 'sl_prefs_v1';

export const state = {
  ready: false,
  authenticated: false,
  authRequired: true,
  user: null,

  route: { name: 'current', listId: null },

  current: null, // lista atual, com itens
  viewing: null, // lista aberta na tela (pode ser a atual)
  openLists: [],
  history: [],
  historyCount: 0,

  online: navigator.onLine,
  live: false,
  syncing: 0,
  error: null,
};

export const prefs = loadPrefs();

const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function setState(patch) {
  Object.assign(state, patch);
  emit();
}

export function emit() {
  for (const fn of subscribers) fn(state);
}

export function setPref(key, value) {
  prefs[key] = value;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // sem armazenamento: preferencia vale só nesta sessão
  }
  emit();
}

function loadPrefs() {
  const defaults = { hideChecked: false, carryOver: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

/** Guarda a última visao conhecida para o app abrir com conteúdo sem rede. */
export function saveSnapshot() {
  try {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        current: state.current,
        viewing: state.viewing,
        openLists: state.openLists,
        historyCount: state.historyCount,
        user: state.user,
        at: Date.now(),
      }),
    );
  } catch {
    // ignora falha de quota
  }
}

export function loadSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // ignora
  }
}

/* --------------------------------------------------------- utilitarios -- */

export function listById(id) {
  if (state.current?.id === id) return state.current;
  if (state.viewing?.id === id) return state.viewing;
  return null;
}

/** Aplica uma lista vinda do servidor em todos os lugares onde ela aparece. */
export function applyList(list) {
  if (!list) return;
  const patch = {};
  if (state.current?.id === list.id || list.isCurrent) patch.current = list;
  if (state.viewing?.id === list.id) patch.viewing = list;
  if (Object.keys(patch).length > 0) setState(patch);
}

/** Atualiza um item na lista visivel sem esperar o servidor (otimista). */
export function patchItemLocal(listId, itemId, patch) {
  for (const key of ['current', 'viewing']) {
    const list = state[key];
    if (!list || list.id !== listId) continue;
    const items = list.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item));
    state[key] = { ...list, items, ...countsFor(items) };
  }
  emit();
}

export function addItemLocal(listId, item) {
  for (const key of ['current', 'viewing']) {
    const list = state[key];
    if (!list || list.id !== listId) continue;
    const items = [...list.items, item];
    state[key] = { ...list, items, ...countsFor(items) };
  }
  emit();
}

export function removeItemLocal(listId, itemId) {
  for (const key of ['current', 'viewing']) {
    const list = state[key];
    if (!list || list.id !== listId) continue;
    const items = list.items.filter((item) => item.id !== itemId);
    state[key] = { ...list, items, ...countsFor(items) };
  }
  emit();
}

function countsFor(items) {
  const checked = items.filter((item) => item.checked).length;
  return { totalItems: items.length, checkedItems: checked, pendingItems: items.length - checked };
}
