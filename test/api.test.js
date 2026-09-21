import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';

const config = readConfig({
  HOUSEHOLD_PASSWORD: 'senha-da-casa',
  DATA_DIR: './data',
  COOKIE_SECURE: 'false',
  PORT: '0',
});

async function startServer() {
  const db = openDatabase(':memory:');
  const app = createApp({ config: { ...config, dbFile: ':memory:' }, db });
  const server = http.createServer(app.handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  // Cada "cliente" tem seu proprio cookie - simula aparelhos diferentes
  // falando com o mesmo servidor, para testar sessoes independentes.
  function makeClient() {
    let cookie = '';
    async function call(method, path, body, options = {}) {
      const response = await fetch(base + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(cookie && options.noCookie !== true ? { cookie } : {}),
          ...(options.headers || {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const type = response.headers.get('content-type') || '';
      const data = type.includes('json') ? await response.json() : await response.text();
      return { status: response.status, data, response };
    }
    return {
      call,
      cookie: () => cookie,
      async login(name = 'renan') {
        return call('POST', '/api/login', { name, password: 'senha-da-casa' });
      },
    };
  }

  const primary = makeClient();

  return {
    base,
    call: primary.call,
    app,
    cookie: primary.cookie,
    login: primary.login,
    secondClient: makeClient,
    async close() {
      app.close();
      server.close();
      await once(server, 'close');
      db.close();
    },
  };
}

test('bloqueia quem não entrou e aceita a senha da casa', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const semLogin = await srv.call('GET', '/api/state', undefined, { noCookie: true });
  assert.equal(semLogin.status, 401);

  const errada = await srv.call('POST', '/api/login', { name: 'renan', password: 'chute' });
  assert.equal(errada.status, 401);

  const semNome = await srv.call('POST', '/api/login', { name: '', password: 'senha-da-casa' });
  assert.equal(semNome.status, 400);

  const ok = await srv.login();
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.name, 'renan');

  const me = await srv.call('GET', '/api/me');
  assert.equal(me.data.authenticated, true);

  const state = await srv.call('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.ok(state.data.current.id);
  assert.equal(state.data.current.isCurrent, true);
});

test('fluxo completo: adicionar, marcar, finalizar e consultar histórico', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login('ana');

  const { data: inicial } = await srv.call('GET', '/api/state');
  const listId = inicial.current.id;

  const criado = await srv.call('POST', `/api/lists/${listId}/items`, {
    name: 'Cafe',
    qty: '500 g',
    url: 'mercado.com/cafe',
  });
  assert.equal(criado.status, 201);
  assert.equal(criado.data.items[0].url, 'https://mercado.com/cafe');
  assert.equal(criado.data.items[0].createdBy, 'ana');

  const vários = await srv.call('POST', `/api/lists/${listId}/items`, { names: ['Pao', 'Ovos'] });
  assert.equal(vários.data.items.length, 2);

  const itemId = criado.data.items[0].id;
  const marcado = await srv.call('PATCH', `/api/items/${itemId}`, { checked: true });
  assert.equal(marcado.data.item.checked, true);
  assert.equal(marcado.data.item.checkedBy, 'ana');

  const finalizado = await srv.call('POST', `/api/lists/${listId}/finish`, { carryOver: true });
  assert.equal(finalizado.status, 200);
  assert.equal(finalizado.data.finished.status, 'finished');
  assert.equal(finalizado.data.current.items.length, 2, 'os não comprados vao para a lista nova');

  const histórico = await srv.call('GET', '/api/lists?status=finished');
  assert.equal(histórico.data.total, 1);
  assert.equal(histórico.data.lists[0].id, listId);

  const editarFinalizada = await srv.call('POST', `/api/lists/${listId}/items`, { name: 'Tarde demais' });
  assert.equal(editarFinalizada.status, 409);
});

test('sempre ha uma lista atual, mesmo após excluir', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login();

  const { data: inicial } = await srv.call('GET', '/api/state');
  const removida = await srv.call('DELETE', `/api/lists/${inicial.current.id}`);
  assert.equal(removida.status, 200);
  assert.ok(removida.data.current.id);
  assert.notEqual(removida.data.current.id, inicial.current.id);

  const depois = await srv.call('GET', '/api/state');
  assert.equal(depois.data.current.isCurrent, true);
});

test('listas secundárias e troca da lista atual', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login();

  const nova = await srv.call('POST', '/api/lists', { name: 'Churrasco' });
  assert.equal(nova.status, 201);
  assert.equal(nova.data.list.isCurrent, false);

  const abertas = await srv.call('GET', '/api/lists?status=open');
  assert.equal(abertas.data.lists.length, 2);

  const trocada = await srv.call('PATCH', `/api/lists/${nova.data.list.id}`, { isCurrent: true });
  assert.equal(trocada.data.list.isCurrent, true);

  const state = await srv.call('GET', '/api/state');
  assert.equal(state.data.current.id, nova.data.list.id);
  assert.equal(state.data.current.name, 'Churrasco');
});

test('sugestões usam o histórico da casa', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login();
  const { data } = await srv.call('GET', '/api/state');
  await srv.call('POST', `/api/lists/${data.current.id}/items`, { names: ['Leite', 'Leite condensado'] });

  const todas = await srv.call('GET', '/api/suggestions?q=leite');
  assert.equal(todas.data.suggestions.length, 2);

  const semRepetir = await srv.call('GET', `/api/suggestions?q=leite&excludeListId=${data.current.id}`);
  assert.equal(semRepetir.data.suggestions.length, 0);
});

test('link inválido e recusado com mensagem clara', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login();
  const { data } = await srv.call('GET', '/api/state');

  const ruim = await srv.call('POST', `/api/lists/${data.current.id}/items`, {
    name: 'Ataque',
    url: 'javascript:alert(1)',
  });
  assert.equal(ruim.status, 400);
  assert.match(ruim.data.error, /http/);
});

test('recusa requisição de outra origem', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login();

  const bloqueada = await srv.call('POST', '/api/lists', { name: 'x' }, {
    headers: { origin: 'https://site-malicioso.example' },
  });
  assert.equal(bloqueada.status, 403);
});

test('eventos em tempo real chegam para os outros aparelhos', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login('renan');
  const { data } = await srv.call('GET', '/api/state');

  const semLogin = await fetch(`${srv.base}/api/events`);
  assert.equal(semLogin.status, 401, 'sem cookie o stream e recusado');
  await semLogin.body?.cancel();

  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${srv.base}/api/events`, {
    headers: { cookie: srv.cookie() },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  const readEvent = async (predicate, tentativas = 12) => {
    let buffer = '';
    for (let i = 0; i < tentativas; i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const frame of buffer.split('\n\n')) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6));
        if (predicate(payload)) return payload;
      }
    }
    return null;
  };

  assert.ok(await readEvent((event) => event.type === 'hello'), 'o stream se apresenta ao conectar');

  // Outro aparelho adiciona um item: o stream precisa avisar.
  await srv.call('POST', `/api/lists/${data.current.id}/items`, { name: 'Manteiga' });
  const atualizacao = await readEvent((event) => event.type === 'list:updated');
  assert.ok(atualizacao, 'chegou o aviso de lista atualizada');
  assert.equal(atualizacao.list.id, data.current.id);
  assert.ok(atualizacao.list.items.some((item) => item.name === 'Manteiga'));
  assert.equal(atualizacao.by, 'renan');

  controller.abort();
});

test('saúde do serviço responde sem login', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const health = await srv.call('GET', '/api/health', undefined, { noCookie: true });
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
});

test('página do app e servida e rotas desconhecidas caem no SPA', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const home = await fetch(`${srv.base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Lista de Compras/);

  const manifest = await fetch(`${srv.base}/manifest.webmanifest`);
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json; charset=utf-8');

  const spa = await fetch(`${srv.base}/qualquer/rota`);
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /<div id="app"/);
});

test('convite: link nomeado deixa a pessoa entrar sem senha', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login('renan');

  const criado = await srv.call('POST', '/api/invites', { name: 'Ana' });
  assert.equal(criado.status, 201);
  assert.match(criado.data.url, /\/#\/entrar\/inv_/);
  const inviteId = criado.data.invite.id;
  assert.ok(inviteId, 'o convite precisa vir com um id valido');

  const ana = srv.secondClient();
  const previa = await ana.call('GET', `/api/invites/${inviteId}`, undefined, { noCookie: true });
  assert.deepEqual(previa.data, { valid: true, name: 'Ana' });

  const entrada = await ana.call('POST', `/api/invites/${inviteId}/consume`, {}, { noCookie: true });
  assert.equal(entrada.status, 200);
  assert.equal(entrada.data.user.name, 'Ana');
  assert.ok(ana.cookie(), 'o consumo do convite precisa devolver um cookie de sessao');

  const eu = await ana.call('GET', '/api/me');
  assert.equal(eu.data.user.name, 'Ana');
});

test('convite: abrir o link (GET) nao gasta - so o POST de confirmar gasta', async (t) => {
  // Protege contra bots de previa (WhatsApp/Telegram buscam a URL sozinhos
  // antes de alguem clicar); se o GET consumisse, o link chegaria morto.
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login('renan');

  const { data } = await srv.call('POST', '/api/invites', { name: 'Ana' });
  const id = data.invite.id;

  for (let i = 0; i < 3; i += 1) {
    const previa = await srv.call('GET', `/api/invites/${id}`, undefined, { noCookie: true });
    assert.equal(previa.data.valid, true, `previa numero ${i + 1} deveria continuar valida`);
  }

  const ok = await srv.call('POST', `/api/invites/${id}/consume`, {}, { noCookie: true });
  assert.equal(ok.status, 200);

  const depois = await srv.call('GET', `/api/invites/${id}`, undefined, { noCookie: true });
  assert.equal(depois.data.valid, false);

  const segundaVez = await srv.call('POST', `/api/invites/${id}/consume`, {}, { noCookie: true });
  assert.equal(segundaVez.status, 410);
});

test('convite invalido, expirado ou ja usado nao deixa entrar', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const inexistente = await srv.call('POST', '/api/invites/nao-existe/consume', {}, { noCookie: true });
  assert.equal(inexistente.status, 410);

  const previaInexistente = await srv.call('GET', '/api/invites/nao-existe', undefined, { noCookie: true });
  assert.equal(previaInexistente.data.valid, false);
});

test('so quem esta logado pode gerar convite', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const semLogin = await srv.call('POST', '/api/invites', { name: 'Ana' }, { noCookie: true });
  assert.equal(semLogin.status, 401);
});

test('sessoes: lista os aparelhos logados e revoga um especifico', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login('renan');
  const ana = srv.secondClient();
  await ana.login('ana');

  const lista = await srv.call('GET', '/api/sessions');
  assert.equal(lista.data.sessions.length, 2);
  const nomes = lista.data.sessions.map((s) => s.userName).sort();
  assert.deepEqual(nomes, ['ana', 'renan']);

  const sessaoDaAna = lista.data.sessions.find((s) => s.userName === 'ana');
  const revogar = await srv.call('DELETE', `/api/sessions/${sessaoDaAna.id}`);
  assert.equal(revogar.data.revoked, true);

  // o aparelho da Ana perde acesso na hora, sem precisar fazer nada
  const anaDepois = await ana.call('GET', '/api/me');
  assert.equal(anaDepois.data.authenticated, false);
  const anaRotaProtegida = await ana.call('GET', '/api/state');
  assert.equal(anaRotaProtegida.status, 401);

  // renan continua logado normalmente
  const renanDepois = await srv.call('GET', '/api/me');
  assert.equal(renanDepois.data.authenticated, true);
});

test('sessoes: reset geral derruba todo mundo e exige a senha da casa', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login('renan');
  const ana = srv.secondClient();
  await ana.login('ana');

  const senhaErrada = await srv.call('POST', '/api/sessions/revoke-all', { password: 'chute' });
  assert.equal(senhaErrada.status, 401);
  // ninguem foi derrubado ainda
  assert.equal((await ana.call('GET', '/api/me')).data.authenticated, true);

  const reset = await srv.call('POST', '/api/sessions/revoke-all', { password: 'senha-da-casa' });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.revoked, 2);

  assert.equal((await ana.call('GET', '/api/me')).data.authenticated, false);
  assert.equal((await srv.call('GET', '/api/me')).data.authenticated, false);
});

test('logout revoga a sessao no servidor, nao so limpa o cookie', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  await srv.login('renan');
  const cookieAntigo = srv.cookie();

  await srv.call('POST', '/api/logout');

  // reaproveitar o mesmo cookie manualmente (como se alguem o tivesse
  // roubado antes do logout) nao deve mais funcionar
  const reuso = await fetch(`${srv.base}/api/me`, { headers: { cookie: cookieAntigo } });
  const dados = await reuso.json();
  assert.equal(dados.authenticated, false);
});
