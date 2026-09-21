/** Ponto de entrada: monta a tela, escuta o tempo real e trata a rota. */
import { el, clear, icon, plural } from './dom.js';
import { drawer, closeDrawer, refreshDrawer, isDrawerOpen, toast, emptyState } from './ui.js';
import * as actions from './actions.js';
import * as api from './api.js';
import { connectLive } from './live.js';
import { ROUTES, go, onRouteChange, parseRoute } from './router.js';
import {
  applyList,
  loadSnapshot,
  prefs,
  setPref,
  setState,
  state,
  subscribe,
} from './state.js';
import {
  finishListFlow,
  itemsCard,
  listMenuSheet,
  listsScreen,
  loginScreen,
  newListFlow,
  statusDots,
  topbar,
} from './views.js';

const root = document.getElementById('app');

/* -------------------------------------------------------- composer ----- */

const composer = buildComposer();
document.body.append(composer.node);

function buildComposer() {
  const input = el('input', {
    class: 'composer__input',
    type: 'text',
    placeholder: 'Adicionar item...',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    'aria-label': 'Novo item',
  });
  const qty = el('input', { class: 'input', type: 'text', placeholder: 'Quantidade (ex.: 2 kg)' });
  // type="text": com type="url" o navegador recusaria "loja.com/item" antes de
  // enviar, e o servidor completa o https:// sozinho.
  const url = el('input', {
    class: 'input',
    type: 'text',
    inputmode: 'url',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: 'Link do produto (compra online)',
  });
  const extra = el('div', { class: 'composer__extra', hidden: true }, [qty, url]);
  const suggestions = el('div', { class: 'suggestions', hidden: true });

  const toggle = el(
    'button',
    {
      class: 'composer__toggle',
      type: 'button',
      'aria-expanded': 'false',
      'aria-label': 'Quantidade e link do produto',
      onClick: () => {
        const open = extra.hidden;
        extra.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open) qty.focus();
      },
    },
    [icon('chevronDown')],
  );

  const send = el(
    'button',
    { class: 'composer__send', type: 'submit', 'aria-label': 'Adicionar', disabled: true },
    [icon('plus', { stroke: 2.6 })],
  );

  const form = el('form', { class: 'composer__inner', onSubmit: onSubmit }, [
    suggestions,
    extra,
    el('div', { class: 'composer__row' }, [
      el('div', { class: 'composer__field' }, [input, toggle]),
      send,
    ]),
  ]);

  const node = el('div', { class: 'composer', hidden: true }, [form]);

  let targetListId = null;
  let debounce;

  input.addEventListener('input', () => {
    send.disabled = input.value.trim().length === 0;
    clearTimeout(debounce);
    debounce = setTimeout(refreshSuggestions, 180);
  });
  input.addEventListener('focus', refreshSuggestions);

  async function refreshSuggestions() {
    if (!targetListId || !state.online) {
      suggestions.hidden = true;
      return;
    }
    const query = input.value.trim();
    try {
      const found = await actions.suggestions(query, targetListId);
      clear(suggestions);
      if (found.length === 0) {
        suggestions.hidden = true;
        return;
      }
      for (const suggestion of found.slice(0, 12)) {
        suggestions.append(
          el('button', {
            class: 'chip',
            type: 'button',
            text: suggestion.name,
            onClick: () => {
              addNow({ name: suggestion.name });
              input.value = '';
              send.disabled = true;
              refreshSuggestions();
            },
          }),
        );
      }
      suggestions.hidden = false;
    } catch {
      suggestions.hidden = true;
    }
  }

  async function addNow(fields) {
    if (!targetListId) return;
    try {
      await actions.addItem(targetListId, fields);
    } catch {
      // erro já reportado por actions
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const raw = input.value.trim();
    if (!raw || !targetListId) return;

    // Várias linhas coladas viram vários itens de uma vez.
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    input.value = '';
    send.disabled = true;

    if (lines.length > 1) {
      await actions.addManyItems(targetListId, lines).catch(() => {});
    } else {
      await addNow({ name: raw, qty: qty.value.trim(), url: url.value.trim() });
    }
    qty.value = '';
    url.value = '';
    extra.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    input.focus({ preventScroll: true });
    refreshSuggestions();
  }

  return {
    node,
    show(listId) {
      const changed = targetListId !== listId;
      targetListId = listId;
      node.hidden = false;
      if (changed) {
        input.value = '';
        qty.value = '';
        url.value = '';
        send.disabled = true;
        suggestions.hidden = true;
      }
    },
    hide() {
      node.hidden = true;
      targetListId = null;
    },
    focus() {
      input.focus();
    },
  };
}

/* ----------------------------------------------------------- render ---- */

let rendering = false;

function render() {
  if (rendering) return;
  rendering = true;
  requestAnimationFrame(() => {
    rendering = false;
    paint();
  });
}

function paint() {
  const scrollY = window.scrollY;
  clear(root);

  if (!state.authenticated) {
    composer.hide();
    root.append(loginScreen({ onDone: start }));
    return;
  }
  if (!state.ready) {
    composer.hide();
    root.append(
      el('div', { class: 'boot' }, [el('div', { class: 'boot__spinner' }), el('p', { text: 'Carregando...' })]),
    );
    return;
  }

  const route = state.route;
  const main = el('main', { class: 'main' });

  if (route.name === 'history') {
    root.append(
      topbar({
        title: 'Histórico',
        subtitle: [plural(state.history.length, 'lista finalizada', 'listas finalizadas')],
        leading: backButton(),
        onMenu: openDrawer,
      }),
    );
    main.append(
      listsScreen(state.history, {
        emptyTitle: 'Nenhuma lista finalizada',
        emptyText: 'Quando você finalizar a lista atual, ela aparece aqui.',
        emptyIcon: 'clock',
      }),
    );
    composer.hide();
  } else if (route.name === 'lists') {
    root.append(
      topbar({
        title: 'Listas abertas',
        subtitle: [plural(state.openLists.length, 'lista', 'listas')],
        leading: backButton(),
        onMenu: openDrawer,
        actionsSlot: [
          el('button', { class: 'iconbtn', 'aria-label': 'Nova lista', onClick: newListFlow }, [icon('plus')]),
        ],
      }),
    );
    main.append(
      listsScreen(state.openLists, {
        emptyTitle: 'Nenhuma lista aberta',
        emptyText: 'Crie uma lista para separar compras diferentes.',
      }),
    );
    composer.hide();
  } else if (route.name === 'about') {
    root.append(topbar({ title: 'Sobre', subtitle: [], leading: backButton(), onMenu: openDrawer }));
    main.append(aboutCard());
    composer.hide();
  } else {
    paintList(main, route);
  }

  root.append(main);
  if (!state.online) root.prepend(el('div', { class: 'offlinebar', text: 'Sem conexão — suas mudanças sobem depois' }));
  window.scrollTo({ top: scrollY });
  if (isDrawerOpen()) refreshDrawer();
}

function paintList(main, route) {
  const isCurrentRoute = route.name === 'current';
  const list = isCurrentRoute ? state.current : state.viewing;

  if (!list) {
    root.append(topbar({ title: 'Lista', subtitle: [], leading: backButton(), onMenu: openDrawer }));
    main.append(el('div', { class: 'card' }, [emptyState('box', 'Lista não encontrada', 'Ela pode ter sido excluída.')]));
    composer.hide();
    return;
  }

  const finished = list.status === 'finished';
  const subtitle = [];
  if (list.totalItems > 0) {
    subtitle.push(el('span', { text: `${list.checkedItems}/${list.totalItems} comprados` }));
  } else {
    subtitle.push(el('span', { text: 'lista vazia' }));
  }
  if (list.isCurrent && !isCurrentRoute) subtitle.push(el('span', { class: 'badge badge--current', text: 'atual' }));
  if (finished) subtitle.push(el('span', { class: 'badge badge--finished', text: 'finalizada' }));
  subtitle.push(...statusDots());
  if (api.outbox.size > 0) {
    subtitle.push(el('span', { class: 'badge', text: `${api.outbox.size} p/ enviar` }));
  }

  root.append(
    topbar({
      title: list.name,
      subtitle,
      list,
      leading: isCurrentRoute ? undefined : backButton(),
      onMenu: openDrawer,
      actionsSlot: [
        list.checkedItems > 0
          ? el(
              'button',
              {
                class: 'iconbtn',
                'aria-label': prefs.hideChecked ? 'Mostrar comprados' : 'Esconder comprados',
                'aria-pressed': prefs.hideChecked ? 'true' : 'false',
                onClick: () => setPref('hideChecked', !prefs.hideChecked),
              },
              [icon(prefs.hideChecked ? 'eyeOff' : 'eye')],
            )
          : null,
        el('button', { class: 'iconbtn', 'aria-label': 'Opções da lista', onClick: () => listMenuSheet(list) }, [
          icon('more'),
        ]),
      ].filter(Boolean),
    }),
  );

  main.append(itemsCard(list, { readOnly: finished }));

  if (!finished) {
    main.append(
      el('div', { class: 'btnrow', style: { marginTop: '16px' } }, [
        el('button', { class: 'btn btn--primary', onClick: () => finishListFlow(list) }, [
          icon('flag'),
          'Finalizar lista',
        ]),
      ]),
    );
    composer.show(list.id);
  } else {
    main.append(
      el('div', { class: 'btnrow', style: { marginTop: '16px' } }, [
        el(
          'button',
          {
            class: 'btn',
            onClick: async () => {
              await actions.reopenList(list.id);
              toast('Lista reaberta.');
            },
          },
          [icon('undo'), 'Reabrir'],
        ),
        el(
          'button',
          {
            class: 'btn',
            onClick: async () => {
              const result = await actions.copyList(list.id, state.current.id, { onlyPending: false });
              toast(`${plural(result.copied, 'item copiado', 'itens copiados')} para a lista atual.`);
            },
          },
          [icon('copy'), 'Copiar para a atual'],
        ),
      ]),
    );
    composer.hide();
  }
}

function backButton() {
  return el('button', { class: 'iconbtn', 'aria-label': 'Voltar', onClick: () => go(ROUTES.current) }, [
    icon('chevronLeft'),
  ]);
}

function aboutCard() {
  return el('div', { class: 'card', style: { padding: '18px' } }, [
    el('h2', { style: { marginTop: '0' }, text: 'Lista de Compras' }),
    el('p', {
      style: { color: 'var(--text-muted)', lineHeight: '1.6' },
      text:
        'Lista compartilhada da família. Tudo que alguém marca aparece na hora nos outros ' +
        'celulares. Sem sinal, as mudanças ficam guardadas e sobem quando a internet volta.',
    }),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn', onClick: () => window.location.reload() }, [icon('refresh'), 'Recarregar']),
      el('button', { class: 'btn btn--danger', onClick: actions.logout }, [icon('logout'), 'Sair']),
    ]),
  ]);
}

/* ----------------------------------------------------------- drawer ---- */

function openDrawer() {
  drawer((close) => {
    const nav = (iconName, label, target, count = null, active = false) =>
      el(
        'button',
        {
          class: `navitem${active ? ' navitem--active' : ''}`,
          onClick: () => {
            close();
            if (typeof target === 'function') target();
            else go(target);
          },
        },
        [
          icon(iconName),
          el('span', { class: 'navitem__text', text: label }),
          count !== null ? el('span', { class: 'navitem__count', text: String(count) }) : null,
        ].filter(Boolean),
      );

    const route = state.route;
    const secondary = state.openLists.filter((list) => !list.isCurrent);

    const body = el('div', { class: 'drawer__body' }, [
      el('ul', { class: 'navlist' }, [
        el('li', {}, [
          nav(
            'cart',
            state.current?.name ?? 'Lista atual',
            ROUTES.current,
            state.current ? `${state.current.checkedItems}/${state.current.totalItems}` : null,
            route.name === 'current',
          ),
        ]),
        el('li', {}, [nav('clock', 'Histórico', ROUTES.history, state.historyCount, route.name === 'history')]),
        el('li', {}, [nav('plus', 'Nova lista', () => newListFlow())]),
      ]),
    ]);

    if (secondary.length > 0) {
      body.append(
        el('p', { class: 'section-title', text: 'Outras listas abertas' }),
        el(
          'ul',
          { class: 'navlist' },
          secondary.map((list) =>
            el('li', {}, [
              nav(
                'lists',
                list.name,
                ROUTES.list(list.id),
                `${list.checkedItems}/${list.totalItems}`,
                route.listId === list.id,
              ),
            ]),
          ),
        ),
      );
    } else {
      body.append(
        el('p', { class: 'section-title', text: 'Outras listas abertas' }),
        el('p', { class: 'hint', style: { padding: '0 12px 8px' }, text: 'Nenhuma. Crie uma em "Nova lista".' }),
      );
    }

    const status = state.online
      ? state.live
        ? 'ao vivo'
        : 'conectando...'
      : 'offline';

    return [
      el('div', { class: 'drawer__head' }, [
        el('div', { class: 'drawer__brand' }, [
          el('img', { src: '/icons/icon.svg', alt: '' }),
          el('span', { text: 'Lista de Compras' }),
        ]),
        el('div', { class: 'drawer__user', text: state.user?.name ? `Você é ${state.user.name}` : '' }),
      ]),
      body,
      el('div', { class: 'drawer__foot' }, [
        el('span', { text: status }),
        el(
          'button',
          {
            class: 'btn btn--ghost',
            style: { minHeight: '36px', padding: '6px 10px' },
            onClick: () => {
              close();
              go(ROUTES.about);
            },
          },
          ['Sobre'],
        ),
      ]),
    ];
  });
}

/* ------------------------------------------------------ inicialização -- */

async function handleRoute() {
  const route = parseRoute();
  setState({ route });
  if (route.name === 'list' && route.listId) {
    if (state.viewing?.id !== route.listId) {
      const known = state.openLists.find((list) => list.id === route.listId);
      setState({ viewing: known ? { ...known, items: [] } : null });
    }
    try {
      await actions.loadList(route.listId);
    } catch {
      setState({ viewing: null });
    }
  } else if (route.name === 'history') {
    await actions.loadHistory().catch(() => {});
  } else if (route.name === 'lists') {
    await actions.loadOpenLists().catch(() => {});
  } else if (route.name === 'current' && state.current) {
    setState({ viewing: state.current });
  }
}

function onLiveEvent(event) {
  if (event.origin && event.origin === api.clientId) return; // eco das nossas próprias ações
  if (event.type === 'list:updated' && event.list) {
    applyList(event.list);
    const index = state.openLists.findIndex((list) => list.id === event.list.id);
    if (index >= 0) {
      const openLists = [...state.openLists];
      openLists[index] = { ...openLists[index], ...event.list, items: undefined };
      setState({ openLists });
    }
  } else if (event.type === 'lists:changed') {
    actions.loadOpenLists().catch(() => {});
    if (state.route.name === 'history') actions.loadHistory().catch(() => {});
    if (!state.current || state.current.status === 'finished') actions.loadState().catch(() => {});
  } else if (event.type === 'list:removed') {
    if (state.viewing?.id === event.listId) go(ROUTES.current);
    actions.loadState().catch(() => {});
  }
}

async function start() {
  setState({ ready: false });
  try {
    await actions.loadState();
  } catch (error) {
    const snapshot = loadSnapshot();
    if (snapshot?.current) {
      setState({ ...snapshot, ready: true });
      toast('Mostrando a última versão salva no aparelho.');
    } else {
      setState({ ready: true });
      toast(error.message || 'Não consegui carregar as listas.', { type: 'error' });
    }
  }
  await handleRoute();

  connectLive({
    onEvent: onLiveEvent,
    onStatus: (live) => {
      setState({ live });
      if (live) {
        actions.flush().catch(() => {});
        actions.loadState().catch(() => {});
        if (state.route.name === 'list' && state.route.listId) {
          actions.loadList(state.route.listId).catch(() => {});
        }
      }
    },
  });
}

async function boot() {
  subscribe(render);
  api.outbox.onChange(render);
  onRouteChange(handleRoute);

  window.addEventListener('online', () => {
    setState({ online: true });
    actions.flush().catch(() => {});
  });
  window.addEventListener('offline', () => setState({ online: false, live: false }));

  // Voltar para o app depois de um tempo no bolso: recarrega o que mudou.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.authenticated) return;
    actions.flush().catch(() => {});
    actions.loadState().catch(() => {});
    if (state.route.name === 'list' && state.route.listId) {
      actions.loadList(state.route.listId).catch(() => {});
    }
  });

  try {
    const me = await actions.checkSession();
    if (me.authenticated) await start();
    else render();
  } catch {
    const snapshot = loadSnapshot();
    if (snapshot?.current) {
      setState({ authenticated: true, ...snapshot, ready: true });
      toast('Sem conexão. Mostrando a última versão salva.');
    } else {
      setState({ ready: true });
      render();
    }
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // sem service worker o app ainda funciona, só não instala/abre offline
    });
  });
}

boot();
