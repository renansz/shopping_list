import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { Store, ValidationError, normalizeUrl, separaItens } from '../server/store.js';

function newStore() {
  return new Store(openDatabase(':memory:'));
}

test('sempre existe uma lista atual', () => {
  const store = newStore();
  const current = store.ensureCurrentList('renan');
  assert.equal(current.isCurrent, true);
  assert.equal(current.status, 'open');
  // chamar de novo não cria outra
  assert.equal(store.ensureCurrentList().id, current.id);
  assert.equal(store.countLists('open'), 1);
});

test('adiciona, marca e remove itens', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  const item = store.addItem(list.id, { name: '  Arroz   5kg ', qty: '2', author: 'renan' });
  assert.equal(item.name, 'Arroz 5kg');
  assert.equal(item.checked, false);

  store.toggleItem(item.id, true, { author: 'ana' });
  const checked = store.getItem(item.id);
  assert.equal(checked.checked, true);
  assert.equal(checked.checkedBy, 'ana');
  assert.ok(checked.checkedAt);

  assert.equal(store.getList(list.id).checkedItems, 1);
  store.deleteItem(item.id);
  assert.equal(store.items(list.id).length, 0);
});

test('item exige nome', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  assert.throws(() => store.addItem(list.id, { name: '   ' }), ValidationError);
});

test('vários itens de uma vez', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  const created = store.addItems(list.id, ['pao', '', 'leite', '  queijo ']);
  assert.deepEqual(created.map((item) => item.name), ['pao', 'leite', 'queijo']);
});

test('separa itens por vírgula, ponto e vírgula e quebra de linha', () => {
  assert.deepEqual(separaItens('abacate, tomate, maçã'), ['abacate', 'tomate', 'maçã']);
  assert.deepEqual(separaItens('abacate; tomate; maçã'), ['abacate', 'tomate', 'maçã']);
  assert.deepEqual(separaItens('abacate\ntomate\nmaçã'), ['abacate', 'tomate', 'maçã']);
  assert.deepEqual(separaItens('abacate, tomate; maçã\nuva'), ['abacate', 'tomate', 'maçã', 'uva']);
});

test('vírgula entre dígitos é decimal, não separador', () => {
  assert.deepEqual(separaItens('arroz 1,5 kg'), ['arroz 1,5 kg']);
  assert.deepEqual(separaItens('1,5'), ['1,5']);
  assert.deepEqual(separaItens('arroz 1,5 kg, feijão 2,5 kg'), ['arroz 1,5 kg', 'feijão 2,5 kg']);
  // só não separa com dígito dos dois lados
  assert.deepEqual(separaItens('arroz 5,feijão 2'), ['arroz 5', 'feijão 2']);
  // ponto e vírgula entre dígitos separa normalmente
  assert.deepEqual(separaItens('1;5'), ['1', '5']);
});

test('separar limpa espaços e tabulações das pontas e descarta pedaços vazios', () => {
  assert.deepEqual(separaItens('  abacate ,  tomate  '), ['abacate', 'tomate']);
  assert.deepEqual(separaItens('\tabacate\t\n \t tomate \t'), ['abacate', 'tomate']);
  assert.deepEqual(separaItens('abacate,,tomate,'), ['abacate', 'tomate']);
  assert.deepEqual(separaItens(' ,; \n '), []);
  assert.deepEqual(separaItens('   \n\t  '), []);
  assert.deepEqual(separaItens(''), []);
});

test('quebra de linha do Windows e de app de celular (CRLF) separa igual', () => {
  // Copiar de WhatsApp, Notes do iPhone ou planilha costuma trazer \r\n:
  // sem tratar isso, sobraria um \r grudado no fim de cada item.
  assert.deepEqual(separaItens('abacate\r\ntomate\r\nmaçã'), ['abacate', 'tomate', 'maçã']);
  assert.deepEqual(separaItens('abacate\rtomate'), ['abacate', 'tomate']);
});

test('linhas em branco no meio não viram itens vazios', () => {
  assert.deepEqual(separaItens('abacate\n\n\ntomate'), ['abacate', 'tomate']);
  assert.deepEqual(separaItens('\n abacate \n\n tomate \n'), ['abacate', 'tomate']);
  assert.deepEqual(separaItens('abacate\r\n\r\ntomate'), ['abacate', 'tomate']);
});

test('quebra de linha convive com vírgula na mesma linha', () => {
  assert.deepEqual(separaItens('arroz, feijão\nleite 1,5 L'), ['arroz', 'feijão', 'leite 1,5 L']);
});

test('texto sem separador continua virando um item só', () => {
  assert.deepEqual(separaItens('leite integral'), ['leite integral']);
  assert.deepEqual(separaItens('  leite integral  '), ['leite integral']);
});

test('limite de 100 vale também para linhas coladas', () => {
  const cem = Array.from({ length: 100 }, (_, n) => `item ${n + 1}`);
  assert.equal(separaItens(cem.join('\r\n')).length, 100);
  assert.throws(() => separaItens([...cem, 'item 101'].join('\n')), ValidationError);
});

test('recusa colar mais de 100 itens de uma vez', () => {
  const cem = Array.from({ length: 100 }, (_, n) => `item ${n + 1}`);
  assert.equal(separaItens(cem.join(',')).length, 100);
  assert.throws(() => separaItens([...cem, 'item 101'].join(',')), ValidationError);
  assert.throws(() => separaItens([...cem, 'item 101'].join(',')), /100 itens de uma vez/);
});

test('adicionar vários aceita os separadores no texto colado', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  const created = store.addItems(list.id, 'abacate, tomate; maçã\narroz 1,5 kg');
  assert.deepEqual(created.map((item) => item.name), ['abacate', 'tomate', 'maçã', 'arroz 1,5 kg']);
});

test('adicionar vários a partir de texto com CRLF não deixa \\r no nome', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  const created = store.addItems(list.id, 'abacate\r\ntomate\r\n\r\nmaçã\r\n');
  assert.deepEqual(created.map((item) => item.name), ['abacate', 'tomate', 'maçã']);
  assert.ok(created.every((item) => !item.name.includes('\r')));
});

test('link do item só aceita http(s) e completa o esquema', () => {
  assert.equal(normalizeUrl('exemplo.com/p/1'), 'https://exemplo.com/p/1');
  assert.equal(normalizeUrl('http://loja.com/x'), 'http://loja.com/x');
  assert.equal(normalizeUrl(''), '');
  assert.throws(() => normalizeUrl('javascript:alert(1)'), ValidationError);
});

test('finalizar lista arquiva e cria a próxima levando pendências', () => {
  const store = newStore();
  const list = store.ensureCurrentList('renan');
  const comprado = store.addItem(list.id, { name: 'arroz' });
  store.addItem(list.id, { name: 'feijao' });
  store.addItem(list.id, { name: 'leite', qty: '2 L', url: 'mercado.com/leite' });
  store.toggleItem(comprado.id, true, { author: 'renan' });

  const { finished, current } = store.finishList(list.id, { author: 'renan', carryOver: true });

  assert.equal(finished.status, 'finished');
  assert.equal(finished.isCurrent, false);
  assert.equal(finished.finishedBy, 'renan');
  assert.equal(finished.totalItems, 3, 'a lista finalizada mantem o histórico completo');

  assert.notEqual(current.id, finished.id);
  assert.equal(current.isCurrent, true);
  const carried = store.items(current.id);
  assert.deepEqual(carried.map((item) => item.name), ['feijao', 'leite']);
  assert.equal(carried[1].qty, '2 L');
  assert.equal(carried[1].url, 'https://mercado.com/leite');
  assert.ok(carried.every((item) => item.checked === false));
});

test('finalizar sem levar pendências', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  store.addItem(list.id, { name: 'arroz' });
  const { current } = store.finishList(list.id, { carryOver: false });
  assert.equal(store.items(current.id).length, 0);
});

test('lista finalizada não aceita edicao até ser reaberta', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  const item = store.addItem(list.id, { name: 'arroz' });
  store.finishList(list.id);

  assert.throws(() => store.addItem(list.id, { name: 'sal' }), /finalizada/);
  assert.throws(() => store.toggleItem(item.id, true), /finalizada/);

  store.reopenList(list.id, { makeCurrent: false });
  assert.equal(store.getList(list.id).status, 'open');
  assert.doesNotThrow(() => store.addItem(list.id, { name: 'sal' }));
});

test('listas secundárias convivem com a atual', () => {
  const store = newStore();
  const atual = store.ensureCurrentList();
  const churrasco = store.createList({ name: 'Churrasco' });
  assert.equal(churrasco.isCurrent, false);
  assert.equal(store.listSummaries({ status: 'open' }).length, 2);

  store.setCurrentList(churrasco.id);
  assert.equal(store.getList(churrasco.id).isCurrent, true);
  assert.equal(store.getList(atual.id).isCurrent, false);
});

test('excluir a lista atual promove outra no lugar', () => {
  const store = newStore();
  const atual = store.ensureCurrentList();
  const { current } = store.deleteList(atual.id);
  assert.ok(current);
  assert.equal(current.isCurrent, true);
  assert.notEqual(current.id, atual.id);
});

test('nomes automáticos não se repetem', () => {
  const store = newStore();
  const primeira = store.ensureCurrentList();
  const { current: segunda } = store.finishList(primeira.id);
  assert.notEqual(primeira.name, segunda.name);
});

test('sugestões vem do histórico, sem repetir o que já está na lista', () => {
  const store = newStore();
  const antiga = store.ensureCurrentList();
  store.addItems(antiga.id, ['arroz', 'arroz branco', 'leite']);
  const { current } = store.finishList(antiga.id, { carryOver: false });
  store.addItem(current.id, { name: 'leite' });

  const todas = store.suggestions('', 10).map((s) => s.name);
  assert.ok(todas.includes('arroz'));

  const filtradas = store.suggestions('arr', 10).map((s) => s.name);
  assert.deepEqual(filtradas.sort(), ['arroz', 'arroz branco']);

  const semRepetir = store.suggestions('', 10, current.id).map((s) => s.name);
  assert.ok(!semRepetir.includes('leite'));
});

test('limpar comprados e desmarcar todos', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  const a = store.addItem(list.id, { name: 'a' });
  const b = store.addItem(list.id, { name: 'b' });
  store.toggleItem(a.id, true);

  store.uncheckAll(list.id);
  assert.equal(store.getList(list.id).checkedItems, 0);

  store.toggleItem(b.id, true);
  const result = store.clearChecked(list.id);
  assert.equal(result.removed, 1);
  assert.deepEqual(store.items(list.id).map((item) => item.name), ['a']);
});

test('copiar itens entre listas', () => {
  const store = newStore();
  const origem = store.ensureCurrentList();
  const comprado = store.addItem(origem.id, { name: 'arroz' });
  store.addItem(origem.id, { name: 'feijao' });
  store.toggleItem(comprado.id, true);
  const destino = store.createList({ name: 'Mercado online' });

  const parcial = store.copyItems(origem.id, destino.id, { onlyPending: true });
  assert.equal(parcial.copied, 1);
  assert.deepEqual(store.items(destino.id).map((i) => i.name), ['feijao']);

  store.copyItems(origem.id, destino.id, { onlyPending: false });
  assert.equal(store.items(destino.id).length, 3);
});

test('reordenar itens', () => {
  const store = newStore();
  const list = store.ensureCurrentList();
  const a = store.addItem(list.id, { name: 'a' });
  const b = store.addItem(list.id, { name: 'b' });
  const c = store.addItem(list.id, { name: 'c' });
  store.reorderItems(list.id, [c.id, a.id, b.id]);
  assert.deepEqual(store.items(list.id).map((i) => i.name), ['c', 'a', 'b']);
});

test('erros de lista/item inexistentes viram 404', () => {
  const store = newStore();
  assert.throws(() => store.requireList('não-existe'), (error) => error.status === 404);
  assert.throws(() => store.requireItem('não-existe'), (error) => error.status === 404);
});
