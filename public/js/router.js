/**
 * Rotas por hash: funcionam offline e no modo standalone do iOS.
 * Os caminhos ficam sem acento de propósito — o navegador codifica acentos
 * em %XX no location.hash e a comparação deixaria de bater.
 */

export const ROUTES = {
  current: '#/',
  list: (id) => `#/lista/${id}`,
  history: '#/historico',
  lists: '#/listas',
  about: '#/sobre',
  access: '#/acessos',
  enter: (token) => `#/entrar/${token}`,
};

export function parseRoute(hash = window.location.hash) {
  const clean = (hash || '').replace(/^#/, '');
  if (clean.startsWith('/lista/')) {
    return { name: 'list', listId: decodeURIComponent(clean.slice('/lista/'.length)) };
  }
  if (clean.startsWith('/entrar/')) {
    return { name: 'enter', inviteId: decodeURIComponent(clean.slice('/entrar/'.length)) };
  }
  if (clean.startsWith('/historico')) return { name: 'history', listId: null };
  if (clean.startsWith('/listas')) return { name: 'lists', listId: null };
  if (clean.startsWith('/sobre')) return { name: 'about', listId: null };
  if (clean.startsWith('/acessos')) return { name: 'access', listId: null };
  return { name: 'current', listId: null };
}

export function go(hash) {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

export function back() {
  if (window.history.length > 1) window.history.back();
  else go(ROUTES.current);
}

export function onRouteChange(fn) {
  window.addEventListener('hashchange', () => fn(parseRoute()));
}
