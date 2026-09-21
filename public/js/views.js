/** Telas e componentes visuais. */
import { el, icon, formatDate, formatRelative, plural, hostOf } from './dom.js';
import { confirmSheet, emptyState, field, sheet, toast } from './ui.js';
import * as actions from './actions.js';
import { prefs, setPref, state } from './state.js';
import { ROUTES, go } from './router.js';

/* ------------------------------------------------------------- login --- */

export function loginScreen({ onDone }) {
  const nameInput = el('input', {
    class: 'input',
    id: 'login-name',
    type: 'text',
    autocomplete: 'nickname',
    placeholder: 'Ex.: Renan',
    value: localStorage.getItem('sl_last_name') || '',
    required: true,
  });
  const passInput = el('input', {
    class: 'input',
    id: 'login-pass',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'Senha da casa',
  });
  const errorBox = el('div', { class: 'error', hidden: true });
  const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Entrar' });

  const form = el(
    'form',
    {
      onSubmit: async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        submit.disabled = true;
        submit.textContent = 'Entrando...';
        try {
          await actions.login(nameInput.value.trim(), passInput.value);
          localStorage.setItem('sl_last_name', nameInput.value.trim());
          onDone();
        } catch (error) {
          errorBox.textContent = error.message || 'Não consegui entrar.';
          errorBox.hidden = false;
          submit.disabled = false;
          submit.textContent = 'Entrar';
        }
      },
    },
    [
      field('Seu nome', nameInput, 'Aparece para a família em quem adicionou e comprou cada item.'),
      state.authRequired ? field('Senha da casa', passInput) : null,
      errorBox,
      submit,
    ].filter(Boolean),
  );

  return el('div', { class: 'login' }, [
    el('div', { class: 'login__box' }, [
      el('img', { class: 'login__logo', src: '/icons/icon.svg', alt: '' }),
      el('h1', { text: 'Lista de Compras' }),
      el('p', { class: 'sub', text: 'A lista da família, sempre atualizada.' }),
      form,
    ]),
  ]);
}

/* ------------------------------------------------------------ topbar --- */

export function topbar({ title, subtitle, list = null, onMenu, leading = null, actionsSlot = [] }) {
  const meta = el('div', { class: 'topbar__meta' }, subtitle);
  const bar = el('header', { class: 'topbar' }, [
    el('div', { class: 'topbar__row' }, [
      leading ??
        el('button', { class: 'iconbtn', 'aria-label': 'Abrir menu', onClick: onMenu }, [icon('menu')]),
      el('div', { class: 'topbar__title' }, [el('h1', { text: title }), meta]),
      ...actionsSlot,
    ]),
  ]);

  if (list && list.totalItems > 0) {
    const percent = Math.round((list.checkedItems / list.totalItems) * 100);
    bar.append(
      el('div', { class: 'progress' }, [
        el('div', { class: 'progress__bar', style: { width: `${percent}%` } }),
      ]),
    );
  }
  return bar;
}

export function statusDots() {
  const nodes = [];
  if (!state.online) {
    nodes.push(el('span', { class: 'dot dot--off' }), el('span', { text: 'offline' }));
  } else if (state.live) {
    nodes.push(el('span', { class: 'dot dot--live' }), el('span', { text: 'ao vivo' }));
  }
  return nodes;
}

/* ------------------------------------------------------------- itens --- */

export function itemRow(item, { readOnly = false } = {}) {
  const row = el('li', {
    class: `item${item.checked ? ' item--checked' : ''}${item.pending ? ' item--pending-sync' : ''}`,
    dataset: { id: item.id },
  });

  const checkMark = el('span', { class: 'check' }, [icon('check', { size: 16, stroke: 3 })]);
  row.append(
    readOnly
      ? el('span', { class: 'item__check item__check--static' }, [checkMark])
      : el(
          'button',
          {
            class: 'item__check',
            'aria-label': item.checked ? `Desmarcar ${item.name}` : `Marcar ${item.name} como comprado`,
            'aria-pressed': item.checked ? 'true' : 'false',
            onClick: () => actions.toggleItem(item),
          },
          [checkMark],
        ),
  );

  // Autoria só aparece quando foi outra pessoa da casa: lista de si mesmo polui.
  const me = state.user?.name;
  const sub = [];
  if (item.note) sub.push(item.note.split('\n')[0]);
  if (item.checked && item.checkedBy && item.checkedBy !== me) sub.push(`comprado por ${item.checkedBy}`);
  else if (!item.checked && item.createdBy && item.createdBy !== me) sub.push(`pedido por ${item.createdBy}`);
  if (item.url) sub.push(hostOf(item.url));

  row.append(
    el(
      'button',
      {
        class: 'item__body',
        onClick: () => itemSheet(item, { readOnly }),
        'aria-label': `Editar ${item.name}`,
      },
      [
        el('span', { class: 'item__line' }, [
          el('span', { class: 'item__name', text: item.name }),
          item.qty ? el('span', { class: 'item__qty', text: item.qty }) : null,
        ]),
        sub.length ? el('span', { class: 'item__sub', text: sub.join(' · ') }) : null,
      ],
    ),
  );

  if (item.url) {
    row.append(
      el(
        'a',
        {
          class: 'item__link',
          href: item.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': `Abrir link de ${item.name}`,
          onClick: (event) => event.stopPropagation(),
        },
        [icon('link')],
      ),
    );
  }
  return row;
}

export function itemsCard(list, { readOnly = false } = {}) {
  const visible = prefs.hideChecked ? list.items.filter((item) => !item.checked) : list.items;

  if (list.items.length === 0) {
    return el('div', { class: 'card' }, [
      emptyState('cart', 'Lista vazia', 'Escreva o primeiro item na barra de baixo.'),
    ]);
  }
  if (visible.length === 0) {
    return el('div', { class: 'card' }, [
      emptyState('flag', 'Tudo comprado!', 'Os itens comprados estao escondidos.'),
    ]);
  }
  return el('div', { class: 'card' }, [
    el(
      'ul',
      { class: 'items' },
      visible.map((item) => itemRow(item, { readOnly })),
    ),
  ]);
}

/* -------------------------------------------------- folha de um item --- */

export function itemSheet(item, { readOnly = false } = {}) {
  sheet((close) => {
    const name = el('input', { class: 'input', type: 'text', value: item.name, disabled: readOnly });
    const qty = el('input', {
      class: 'input',
      type: 'text',
      value: item.qty || '',
      placeholder: 'Ex.: 2 kg, 3 caixas',
      disabled: readOnly,
    });
    const url = el('input', {
      class: 'input',
      type: 'text',
      inputmode: 'url',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      value: item.url || '',
      placeholder: 'loja.com/produto',
      disabled: readOnly,
    });
    const note = el('textarea', {
      class: 'textarea',
      placeholder: 'Marca preferida, observação...',
      disabled: readOnly,
    });
    note.value = item.note || '';

    const save = async () => {
      const patch = {
        name: name.value.trim(),
        qty: qty.value.trim(),
        url: url.value.trim(),
        note: note.value.trim(),
      };
      if (!patch.name) {
        toast('O item precisa de um nome.', { type: 'error' });
        return;
      }
      close();
      await actions.updateItem(item, patch).catch(() => {});
    };

    const info = [];
    if (item.createdBy) info.push(`Adicionado por ${item.createdBy} ${formatRelative(item.createdAt)}`);
    if (item.checked && item.checkedBy) info.push(`Comprado por ${item.checkedBy} ${formatRelative(item.checkedAt)}`);

    return [
      el('h2', { class: 'sheet__title', text: readOnly ? item.name : 'Editar item' }),
      info.length ? el('p', { class: 'sheet__desc', text: info.join(' · ') }) : null,
      readOnly
        ? null
        : el('div', { class: 'sheet__form' }, [
            field('Item', name),
            field('Quantidade', qty),
            field('Link da loja', url, 'Para compras online: o item vira um atalho para o produto.'),
            field('Observação', note),
          ]),
      item.url
        ? el(
            'a',
            { class: 'btn btn--block', href: item.url, target: '_blank', rel: 'noopener noreferrer' },
            [icon('link'), `Abrir ${hostOf(item.url)}`],
          )
        : null,
      readOnly
        ? null
        : el('div', { class: 'btnrow', style: { marginTop: '10px' } }, [
            el(
              'button',
              {
                class: 'btn btn--danger',
                onClick: async () => {
                  close();
                  await actions.deleteItem(item);
                },
              },
              [icon('trash'), 'Remover'],
            ),
            el('button', { class: 'btn btn--primary', onClick: save }, [icon('check'), 'Salvar']),
          ]),
    ].filter(Boolean);
  });
}

/* ------------------------------------------------- folha de uma lista --- */

export function listMenuSheet(list) {
  sheet((close) => {
    const finished = list.status === 'finished';
    const buttons = [];

    const action = (iconName, label, handler, className = 'btn btn--block') =>
      el(
        'button',
        {
          class: className,
          style: { justifyContent: 'flex-start' },
          onClick: async () => {
            close();
            await handler();
          },
        },
        [icon(iconName), label],
      );

    if (!finished) {
      buttons.push(action('flag', 'Finalizar lista', () => finishListFlow(list)));
      if (!list.isCurrent) {
        buttons.push(action('cart', 'Tornar esta a lista atual', async () => {
          await actions.setCurrentList(list.id);
          go(ROUTES.current);
          toast(`"${list.name}" agora é a lista atual.`);
        }));
      }
      buttons.push(action('edit', 'Renomear', () => renameFlow(list)));
      if (list.checkedItems > 0) {
        buttons.push(
          action('trash', `Remover ${plural(list.checkedItems, 'item comprado', 'itens comprados')}`, async () => {
            const ok = await confirmSheet({
              title: 'Remover itens comprados?',
              description: 'Eles somem desta lista. O histórico das listas finalizadas não muda.',
              confirmLabel: 'Remover',
              danger: true,
            });
            if (ok) await actions.clearChecked(list.id);
          }),
        );
        buttons.push(action('undo', 'Desmarcar todos', () => actions.uncheckAll(list.id)));
      }
    } else {
      buttons.push(
        action('undo', 'Reabrir lista', async () => {
          await actions.reopenList(list.id);
          toast('Lista reaberta.');
          go(ROUTES.list(list.id));
        }),
      );
      buttons.push(
        action('copy', 'Copiar itens para a lista atual', async () => {
          const result = await actions.copyList(list.id, state.current.id, { onlyPending: false });
          toast(`${plural(result.copied, 'item copiado', 'itens copiados')} para "${state.current.name}".`);
          go(ROUTES.current);
        }),
      );
    }

    buttons.push(
      action(
        'trash',
        'Excluir lista',
        async () => {
          const ok = await confirmSheet({
            title: `Excluir "${list.name}"?`,
            description: 'Os itens dela vao junto. Não da para desfazer.',
            confirmLabel: 'Excluir',
            danger: true,
          });
          if (!ok) return;
          await actions.deleteList(list.id);
          toast('Lista excluída.');
          go(ROUTES.current);
        },
        'btn btn--danger btn--block',
      ),
    );

    const meta = [
      `Criada ${formatRelative(list.createdAt)}`,
      list.createdBy ? `por ${list.createdBy}` : null,
      finished && list.finishedAt ? `· finalizada ${formatRelative(list.finishedAt)}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    return [
      el('h2', { class: 'sheet__title', text: list.name }),
      el('p', { class: 'sheet__desc', text: meta }),
      el('div', { style: { display: 'grid', gap: '8px' } }, buttons),
    ];
  });
}

export async function finishListFlow(list) {
  const pending = list.pendingItems ?? 0;
  let carryOver = prefs.carryOver;
  const result = await confirmSheet({
    title: `Finalizar "${list.name}"?`,
    description:
      pending > 0
        ? `Ela vai para o histórico com ${plural(pending, 'item não comprado', 'itens não comprados')}.`
        : 'Ela vai para o histórico e uma lista nova entra no lugar.',
    confirmLabel: 'Finalizar',
    extra:
      pending > 0 && list.isCurrent
        ? () => {
            const input = el('input', { type: 'checkbox', id: 'carry', checked: carryOver });
            input.addEventListener('change', () => {
              carryOver = input.checked;
            });
            return {
              node: el('label', { class: 'checkline', for: 'carry' }, [
                input,
                el('span', { text: `Levar os ${plural(pending, 'item pendente', 'itens pendentes')} para a próxima lista` }),
              ]),
              getValue: () => ({ carryOver: input.checked }),
            };
          }
        : null,
  });
  if (!result) return;
  const options = typeof result === 'object' ? result : { carryOver };
  setPref('carryOver', options.carryOver !== false);
  await actions.finishList(list.id, options);
  toast('Lista finalizada. Uma nova já está pronta.');
  go(ROUTES.current);
}

export function renameFlow(list) {
  sheet((close) => {
    const input = el('input', { class: 'input', type: 'text', value: list.name });
    const save = async () => {
      const name = input.value.trim();
      if (!name) return;
      close();
      await actions.renameList(list.id, name);
    };
    return [
      el('h2', { class: 'sheet__title', text: 'Renomear lista' }),
      el('div', { class: 'sheet__form' }, [field('Nome', input)]),
      el('div', { class: 'btnrow' }, [
        el('button', { class: 'btn', text: 'Cancelar', onClick: close }),
        el('button', { class: 'btn btn--primary', text: 'Salvar', onClick: save }),
      ]),
    ];
  });
}

export function newListFlow() {
  sheet((close) => {
    const input = el('input', { class: 'input', type: 'text', placeholder: 'Ex.: Feira da semana' });
    const makeCurrent = el('input', { type: 'checkbox', id: 'make-current' });
    const create = async () => {
      close();
      const list = await actions.createList({
        name: input.value.trim(),
        makeCurrent: makeCurrent.checked,
      });
      go(makeCurrent.checked ? ROUTES.current : ROUTES.list(list.id));
      toast(`"${list.name}" criada.`);
    };
    return [
      el('h2', { class: 'sheet__title', text: 'Nova lista' }),
      el('p', { class: 'sheet__desc', text: 'Use para churrasco, farmacia, compras online...' }),
      el('div', { class: 'sheet__form' }, [
        field('Nome', input, 'Em branco usa a data de hoje.'),
        el('label', { class: 'checkline', for: 'make-current' }, [
          makeCurrent,
          el('span', { text: 'Tornar a lista atual (a que abre na tela inicial)' }),
        ]),
      ]),
      el('div', { class: 'btnrow' }, [
        el('button', { class: 'btn', text: 'Cancelar', onClick: close }),
        el('button', { class: 'btn btn--primary', text: 'Criar', onClick: create }),
      ]),
    ];
  });
}

/* -------------------------------------------------------- listagens ---- */

export function listCard(list) {
  const badges = [];
  if (list.isCurrent) badges.push(el('span', { class: 'badge badge--current', text: 'atual' }));

  const meta =
    list.totalItems === 0
      ? 'Vazia'
      : `${list.checkedItems}/${list.totalItems} comprados · ${
          list.status === 'finished'
            ? `finalizada ${formatDate(list.finishedAt)}`
            : `atualizada ${formatRelative(list.updatedAt)}`
        }`;

  return el(
    'button',
    { class: 'listcard', onClick: () => go(ROUTES.list(list.id)) },
    [
      el('div', { class: 'listcard__main' }, [
        el('div', { class: 'listcard__name' }, [el('span', { text: list.name }), ...badges]),
        el('div', { class: 'listcard__meta', text: meta }),
      ]),
      el('span', { class: 'listcard__chev' }, [icon('chevronRight')]),
    ],
  );
}

export function listsScreen(lists, { emptyTitle, emptyText, emptyIcon = 'lists' }) {
  if (lists.length === 0) {
    return el('div', { class: 'card' }, [emptyState(emptyIcon, emptyTitle, emptyText)]);
  }
  return el('div', { class: 'card' }, lists.map(listCard));
}
