/** Todas as operacoes que mudam dados. Atualiza a tela na hora e sincroniza depois. */
import * as api from './api.js';
import { toast } from './ui.js';
import {
  addItemLocal,
  applyList,
  patchItemLocal,
  removeItemLocal,
  saveSnapshot,
  setState,
  state,
} from './state.js';

function tempId() {
  return `tmp_${Math.random().toString(36).slice(2, 10)}`;
}

function report(error) {
  if (error instanceof api.OfflineError) {
    toast('Sem conexão. A alteração sobe quando a internet voltar.');
    return;
  }
  toast(error.message || 'Não consegui salvar.', { type: 'error' });
}

/* ------------------------------------------------------------ sessão --- */

export async function checkSession() {
  const me = await api.get('/api/me');
  setState({
    authenticated: me.authenticated,
    authRequired: me.authRequired,
    user: me.user,
  });
  return me;
}

export async function login(name, password) {
  const result = await api.post('/api/login', { name, password }, { queue: false });
  setState({ authenticated: true, user: result.user });
  return result;
}

export async function logout() {
  try {
    await api.post('/api/logout', {}, { queue: false });
  } catch {
    // mesmo sem rede, saimos localmente
  }
  localStorage.removeItem('sl_snapshot_v1');
  window.location.reload();
}

/* --------------------------------------------------- convites (magic link) --- */

// So consulta - nunca gasta o convite (seguro contra bots de previa do
// WhatsApp/Telegram, que buscam a URL sozinhos antes de alguem clicar).
export async function previewInvite(id) {
  return api.get(`/api/invites/${id}`);
}

// So chamado quando a pessoa toca em "Entrar como Fulano" - uma acao
// explicita dela, nunca automatica.
export async function consumeInvite(id) {
  const result = await api.post(`/api/invites/${id}/consume`, {}, { queue: false });
  setState({ authenticated: true, user: result.user });
  return result;
}

export async function createInvite(name) {
  const result = await api.post('/api/invites', { name }, { queue: false });
  return result;
}

export async function loadInvites() {
  const result = await api.get('/api/invites');
  setState({ invites: result.invites });
  return result.invites;
}

export async function revokeInvite(id) {
  await api.del(`/api/invites/${id}`, { queue: false });
  await loadInvites();
}

/* ------------------------------------------------------------ acessos --- */

export async function loadSessions() {
  const result = await api.get('/api/sessions');
  setState({ sessions: result.sessions });
  return result.sessions;
}

// Nao recarrega a lista sozinho: se for a propria sessao, o cookie ja foi
// limpo pelo servidor e um refresh em seguida so daria 401 - quem chama
// decide entre recarregar a pagina (saiu do proprio aparelho) ou so
// atualizar a lista (revogou outro aparelho).
export async function revokeSession(id) {
  return api.del(`/api/sessions/${id}`, { queue: false });
}

// Derruba todo mundo, inclusive quem pediu - por isso exige a senha da casa
// de novo, nao so estar logado.
export async function revokeAllSessions(password) {
  const result = await api.post('/api/sessions/revoke-all', { password }, { queue: false });
  if (result.revoked !== undefined) {
    localStorage.removeItem('sl_snapshot_v1');
    window.location.reload();
  }
  return result;
}

/* ------------------------------------------------------------ carga --- */

export async function loadState() {
  const data = await api.get('/api/state');
  setState({
    user: data.user,
    current: data.current,
    openLists: data.openLists,
    historyCount: data.historyCount,
    viewing: state.viewing && state.viewing.id !== data.current.id ? state.viewing : data.current,
    ready: true,
  });
  saveSnapshot();
  return data;
}

export async function loadList(id) {
  const data = await api.get(`/api/lists/${id}`);
  setState({ viewing: data.list });
  if (data.list.isCurrent) setState({ current: data.list });
  saveSnapshot();
  return data.list;
}

export async function loadHistory() {
  const data = await api.get('/api/lists?status=finished&limit=100');
  setState({ history: data.lists, historyCount: data.total });
  return data.lists;
}

export async function loadOpenLists() {
  const data = await api.get('/api/lists?status=open&limit=100');
  setState({ openLists: data.lists });
  return data.lists;
}

export async function suggestions(query, listId) {
  const params = new URLSearchParams({ q: query || '', limit: '12' });
  if (listId) params.set('excludeListId', listId);
  const data = await api.get(`/api/suggestions?${params}`);
  return data.suggestions;
}

/* ------------------------------------------------------------- itens --- */

export async function addItem(listId, fields) {
  const local = {
    id: tempId(),
    listId,
    name: fields.name,
    qty: fields.qty || '',
    url: fields.url || '',
    note: fields.note || '',
    checked: false,
    position: Number.MAX_SAFE_INTEGER,
    createdBy: state.user?.name ?? null,
    createdAt: new Date().toISOString(),
    pending: true,
  };
  addItemLocal(listId, local);
  try {
    const result = await api.post(`/api/lists/${listId}/items`, fields, { tempId: local.id });
    if (result.queued) {
      patchItemLocal(listId, local.id, { pending: true });
      return local;
    }
    if (result.list) applyList(result.list);
    saveSnapshot();
    return result.items?.[0] ?? local;
  } catch (error) {
    removeItemLocal(listId, local.id);
    report(error);
    throw error;
  }
}

export async function addManyItems(listId, names) {
  try {
    const result = await api.post(`/api/lists/${listId}/items`, { names });
    if (result.list) applyList(result.list);
    saveSnapshot();
    return result.items ?? [];
  } catch (error) {
    report(error);
    throw error;
  }
}

export async function toggleItem(item) {
  const next = !item.checked;
  patchItemLocal(item.listId, item.id, {
    checked: next,
    checkedBy: next ? (state.user?.name ?? null) : null,
    checkedAt: next ? new Date().toISOString() : null,
  });
  try {
    const result = await api.patch(`/api/items/${item.id}`, { checked: next });
    if (!result.queued && result.item) patchItemLocal(item.listId, item.id, { ...result.item, pending: false });
    saveSnapshot();
  } catch (error) {
    patchItemLocal(item.listId, item.id, { checked: item.checked });
    report(error);
  }
}

export async function updateItem(item, patch) {
  patchItemLocal(item.listId, item.id, patch);
  try {
    const result = await api.patch(`/api/items/${item.id}`, patch);
    if (!result.queued && result.item) patchItemLocal(item.listId, item.id, result.item);
    saveSnapshot();
  } catch (error) {
    patchItemLocal(item.listId, item.id, item);
    report(error);
    throw error;
  }
}

export async function deleteItem(item) {
  removeItemLocal(item.listId, item.id);
  toast(`"${item.name}" removido`, {
    action: {
      label: 'Desfazer',
      run: () => addItem(item.listId, { name: item.name, qty: item.qty, url: item.url, note: item.note }),
    },
  });
  try {
    await api.del(`/api/items/${item.id}`);
    saveSnapshot();
  } catch (error) {
    addItemLocal(item.listId, item);
    report(error);
  }
}

export async function clearChecked(listId) {
  try {
    const result = await api.post(`/api/lists/${listId}/clear-checked`, {}, { queue: false });
    if (result.list) applyList(result.list);
    toast(result.removed === 1 ? '1 item comprado removido' : `${result.removed} itens comprados removidos`);
    saveSnapshot();
  } catch (error) {
    report(error);
  }
}

export async function uncheckAll(listId) {
  try {
    const result = await api.post(`/api/lists/${listId}/uncheck-all`, {}, { queue: false });
    if (result.list) applyList(result.list);
    saveSnapshot();
  } catch (error) {
    report(error);
  }
}

/* ------------------------------------------------------------ listas --- */

export async function createList({ name, makeCurrent = false } = {}) {
  const result = await api.post('/api/lists', { name, makeCurrent }, { queue: false });
  await Promise.all([loadOpenLists(), makeCurrent ? loadState() : Promise.resolve()]);
  return result.list;
}

export async function renameList(id, name) {
  const result = await api.patch(`/api/lists/${id}`, { name }, { queue: false });
  applyList(result.list);
  await loadOpenLists();
  return result.list;
}

export async function setCurrentList(id) {
  const result = await api.patch(`/api/lists/${id}`, { isCurrent: true }, { queue: false });
  await loadState();
  return result.list;
}

export async function finishList(id, { carryOver = true } = {}) {
  const result = await api.post(`/api/lists/${id}/finish`, { carryOver }, { queue: false });
  await loadState();
  await loadOpenLists();
  return result;
}

export async function reopenList(id, { makeCurrent = false } = {}) {
  const result = await api.post(`/api/lists/${id}/reopen`, { makeCurrent }, { queue: false });
  await loadState();
  await loadOpenLists();
  return result.list;
}

export async function deleteList(id) {
  await api.del(`/api/lists/${id}`, { queue: false });
  await loadState();
  await loadOpenLists();
}

export async function copyList(fromId, targetListId, { onlyPending = true } = {}) {
  const result = await api.post(
    `/api/lists/${fromId}/copy`,
    { targetListId, onlyPending },
    { queue: false },
  );
  applyList(result.list);
  await loadOpenLists();
  return result;
}

/* -------------------------------------------------------- sincronia --- */

export async function flush() {
  if (api.outbox.size === 0) return;
  const result = await api.flushOutbox();
  if (result.sent > 0) {
    await loadState();
    if (state.viewing && state.viewing.id !== state.current?.id) await loadList(state.viewing.id);
    toast(result.sent === 1 ? '1 alteração sincronizada' : `${result.sent} alterações sincronizadas`);
  }
  if (result.failed > 0) {
    toast('Algumas alterações offline não puderam ser salvas.', { type: 'error' });
  }
}
