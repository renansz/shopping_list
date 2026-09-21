import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES, parseRoute } from '../public/js/router.js';

test('as rotas nao tem acento (o navegador codificaria em %XX)', () => {
  const todas = [
    ROUTES.current,
    ROUTES.history,
    ROUTES.lists,
    ROUTES.about,
    ROUTES.access,
    ROUTES.list('abc'),
    ROUTES.enter('inv_abc123'),
  ];
  for (const rota of todas) {
    assert.equal(rota, encodeURI(rota), `rota "${rota}" mudaria ao virar URL`);
  }
});

test('interpreta cada rota', () => {
  assert.deepEqual(parseRoute('#/'), { name: 'current', listId: null });
  assert.deepEqual(parseRoute(''), { name: 'current', listId: null });
  assert.deepEqual(parseRoute('#/historico'), { name: 'history', listId: null });
  assert.deepEqual(parseRoute('#/listas'), { name: 'lists', listId: null });
  assert.deepEqual(parseRoute('#/sobre'), { name: 'about', listId: null });
  assert.deepEqual(parseRoute('#/acessos'), { name: 'access', listId: null });
  assert.deepEqual(parseRoute('#/lista/l_abc123'), { name: 'list', listId: 'l_abc123' });
  assert.deepEqual(parseRoute('#/entrar/inv_xyz789'), { name: 'enter', inviteId: 'inv_xyz789' });
  assert.deepEqual(parseRoute('#/desconhecida'), { name: 'current', listId: null });
});

test('ida e volta da rota de uma lista', () => {
  const id = 'l_mf3k2j_x9';
  assert.deepEqual(parseRoute(ROUTES.list(id)), { name: 'list', listId: id });
});
