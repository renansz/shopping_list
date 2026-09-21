/** Componentes de interface reutilizaveis: avisos, folhas e confirmacoes. */
import { el, clear, icon } from './dom.js';

/* ------------------------------------------------------------ toasts --- */

export function toast(message, { type = 'info', action = null, duration = 3500 } = {}) {
  const host = document.getElementById('toasts');
  const node = el('div', { class: `toast${type === 'error' ? ' toast--error' : ''}` }, [
    el('span', { text: message }),
  ]);
  let timer;
  const close = () => {
    clearTimeout(timer);
    node.remove();
  };
  if (action) {
    node.append(
      el('button', {
        class: 'toast__action',
        text: action.label,
        onClick: () => {
          close();
          action.run();
        },
      }),
    );
  }
  host.append(node);
  timer = setTimeout(close, duration);
  return close;
}

/* ------------------------------------------------------------- sheet --- */

let openSheet = null;

/**
 * Abre uma folha deslizante a partir da base da tela.
 * @param {(close: Function) => Node[]} build conteúdo da folha
 * @param {{onClose?: Function}} options
 */
export function sheet(build, { onClose } = {}) {
  closeSheet();
  const scrim = el('div', { class: 'scrim' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'sheet__grab' }),
  ]);

  const close = () => {
    if (openSheet !== handle) return;
    openSheet = null;
    scrim.classList.remove('scrim--open');
    panel.classList.remove('sheet--open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      scrim.remove();
      panel.remove();
    }, 260);
    onClose?.();
  };

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  const handle = { close };
  openSheet = handle;
  panel.append(...build(close));
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, panel);
  requestAnimationFrame(() => {
    scrim.classList.add('scrim--open');
    panel.classList.add('sheet--open');
    panel.querySelector('input, textarea, button')?.focus({ preventScroll: true });
  });
  return handle;
}

export function closeSheet() {
  openSheet?.close();
}

/**
 * Confirmacao em folha (o confirm() nativo some no modo standalone do iOS).
 * @param {object} options
 * @param {() => {node: Node, getValue: Function}} [options.extra] campo extra
 * @returns {Promise<boolean|any>} false ao cancelar; true (ou o valor do extra) ao confirmar
 */
export function confirmSheet({ title, description, confirmLabel = 'Confirmar', danger = false, extra = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const finishWith = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    sheet(
      (close) => {
        const extraField = extra ? extra() : null;
        const confirm = () => {
          finishWith(extraField ? extraField.getValue() : true);
          close();
        };
        const cancel = () => {
          finishWith(false);
          close();
        };
        return [
          el('h2', { class: 'sheet__title', text: title }),
          description ? el('p', { class: 'sheet__desc', text: description }) : null,
          extraField?.node ?? null,
          el('div', { class: 'btnrow', style: { marginTop: '16px' } }, [
            el('button', { class: 'btn', text: 'Cancelar', onClick: cancel }),
            el('button', {
              class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
              text: confirmLabel,
              onClick: confirm,
            }),
          ]),
        ].filter(Boolean);
      },
      { onClose: () => finishWith(false) },
    );
  });
}

/* ------------------------------------------------------------ drawer --- */

let drawerState = null;

export function drawer(build) {
  if (drawerState) {
    closeDrawer();
    return;
  }
  const scrim = el('div', { class: 'scrim' });
  const panel = el('nav', { class: 'drawer', 'aria-label': 'Menu' });

  const close = () => {
    if (!drawerState) return;
    drawerState = null;
    scrim.classList.remove('scrim--open');
    panel.classList.remove('drawer--open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      scrim.remove();
      panel.remove();
    }, 260);
  };

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  drawerState = { close, panel, build };
  panel.append(...build(close));
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, panel);
  requestAnimationFrame(() => {
    scrim.classList.add('scrim--open');
    panel.classList.add('drawer--open');
  });
}

export function closeDrawer() {
  drawerState?.close();
}

export function refreshDrawer() {
  if (!drawerState) return;
  const { panel, build } = drawerState;
  clear(panel).append(...build(drawerState.close));
}

export const isDrawerOpen = () => Boolean(drawerState);

/* ------------------------------------------------------- formularios --- */

export function field(label, input, hint = null) {
  return el('div', { class: 'field' }, [
    el('label', { text: label, for: input.id || undefined }),
    input,
    hint ? el('span', { class: 'hint', text: hint }) : null,
  ]);
}

export function emptyState(iconName, title, description) {
  return el('div', { class: 'empty' }, [
    icon(iconName, { size: 56, stroke: 1.5 }),
    el('p', { style: { fontWeight: '600', color: 'var(--text)' }, text: title }),
    description ? el('p', { text: description }) : null,
  ]);
}
