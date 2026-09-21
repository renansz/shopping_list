import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, ValidationError } from './store.js';
import { SessionStore } from './sessions.js';
import { EventHub } from './events.js';
import {
  Router,
  clientIp,
  createStaticHandler,
  isSecureRequest,
  originAllowed,
  readJsonBody,
  sendJson,
  sendText,
} from './http.js';
import { LoginThrottle, COOKIE_NAME, checkPassword, clearCookie, parseCookies, sessionCookie } from './auth.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * O app não carrega nada de fora (sem CDN, sem fonte externa, sem script
 * embutido no HTML), então a política pode ser a mais fechada possível.
 * 'data:' fica liberado só para imagens, que é inofensivo e evita surpresa
 * se algum ícone vier embutido no futuro.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

function aplicarCabecalhosDeSeguranca(req, res, config) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('permissions-policy', 'geolocation=(), microphone=(), camera=()');
  // HSTS só faz sentido (e só é honrado) quando a resposta chega por HTTPS.
  if (isSecureRequest(req, config.trustProxy)) {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
}

export function createApp({ config, db }) {
  const store = new Store(db);
  const sessions = new SessionStore(db);
  const hub = new EventHub();
  const loginThrottle = new LoginThrottle();
  const inviteThrottle = new LoginThrottle();
  const serveStatic = createStaticHandler(PUBLIC_DIR);
  const router = new Router();

  store.ensureCurrentList();

  const cookieSecureFor = (req) =>
    config.cookieSecure === 'auto' ? isSecureRequest(req, config.trustProxy) : config.cookieSecure;

  /* ------------------------------------------------------- broadcast ---- */

  function pushList(ctx, listId) {
    const list = store.listWithItems(listId);
    if (list) hub.broadcast('list:updated', { list, by: ctx.user?.name ?? null, origin: ctx.clientId });
  }

  function pushLists(ctx) {
    hub.broadcast('lists:changed', { by: ctx.user?.name ?? null, origin: ctx.clientId });
  }

  /* ---------------------------------------------------------- sessão ---- */

  router.get('/api/me', (req, res, ctx) => {
    sendJson(res, 200, {
      authenticated: Boolean(ctx.user),
      authRequired: !config.authDisabled,
      user: ctx.user ? { name: ctx.user.name } : null,
      sessionId: ctx.sessionId,
      appName: config.appName,
    });
  }, { public: true });

  router.post('/api/login', async (req, res, ctx) => {
    const ip = clientIp(req, config.trustProxy);
    if (!loginThrottle.check(ip)) {
      sendJson(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
      return;
    }
    const body = await readJsonBody(req);
    const name = String(body.name ?? '').trim().slice(0, 40);
    if (!name) {
      sendJson(res, 400, { error: 'Escreva seu nome (aparece para a família).' });
      return;
    }
    if (!config.authDisabled && !checkPassword(body.password, config.password)) {
      loginThrottle.fail(ip);
      sendJson(res, 401, { error: 'Senha incorreta.' });
      return;
    }
    loginThrottle.reset(ip);
    const session = sessions.createSession(name, { createdVia: 'password' });
    sendJson(
      res,
      200,
      { ok: true, user: { name } },
      { 'set-cookie': sessionCookie(session.id, { secure: cookieSecureFor(req) }) },
    );
  }, { public: true });

  router.post('/api/logout', (req, res, ctx) => {
    if (ctx.sessionId) sessions.revoke(ctx.sessionId, 'logout');
    sendJson(res, 200, { ok: true }, { 'set-cookie': clearCookie({ secure: cookieSecureFor(req) }) });
  }, { public: true });

  /* --------------------------------------------------------- convites --- */

  // Link nomeado, de uso unico: quem ja tem acesso gera um para uma pessoa
  // (ou um novo aparelho dela) e manda por WhatsApp/SMS. Quem recebe entra so
  // de confirmar - sem senha, sem digitar nome.
  router.post('/api/invites', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    const invite = sessions.createInvite(body.name, { createdBy: ctx.user?.name ?? null });
    const origin = `${isSecureRequest(req, config.trustProxy) ? 'https' : 'http'}://${req.headers.host}`;
    sendJson(res, 201, { invite, url: `${origin}/#/entrar/${invite.id}` });
  });

  router.get('/api/invites', (req, res) => {
    sendJson(res, 200, { invites: sessions.listInvites() });
  });

  router.delete('/api/invites/:id', (req, res, ctx) => {
    const revoked = sessions.revokeInvite(ctx.params.id);
    sendJson(res, 200, { revoked });
  });

  // Publica e so de LEITURA - nunca gasta o convite. Precisa ser assim porque
  // WhatsApp/Telegram buscam a previa da URL sozinhos antes de alguem clicar;
  // se o simples GET consumisse o link, ele chegaria morto para quem recebeu.
  router.get('/api/invites/:id', (req, res, ctx) => {
    sendJson(res, 200, sessions.getInvite(ctx.params.id));
  }, { public: true });

  // So aqui o convite e de fato gasto - sempre por uma acao explicita da
  // pessoa (o app so chama isto quando ela toca em "Entrar como Fulano").
  router.post('/api/invites/:id/consume', (req, res, ctx) => {
    const ip = clientIp(req, config.trustProxy);
    if (!inviteThrottle.check(ip)) {
      sendJson(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
      return;
    }
    let session;
    try {
      session = sessions.consumeInvite(ctx.params.id);
    } catch (error) {
      inviteThrottle.fail(ip);
      throw error;
    }
    inviteThrottle.reset(ip);
    sendJson(
      res,
      200,
      { ok: true, user: { name: session.userName } },
      { 'set-cookie': sessionCookie(session.id, { secure: cookieSecureFor(req) }) },
    );
  }, { public: true });

  /* --------------------------------------------------------- sessões ---- */

  // Cada aparelho logado vira uma linha aqui - "resetar os acessos" e
  // revogar uma sessao especifica, sem precisar deslogar a casa inteira.
  router.get('/api/sessions', (req, res, ctx) => {
    const list = sessions.listActive().map((session) => ({
      ...session,
      isCurrent: session.id === ctx.sessionId,
    }));
    sendJson(res, 200, { sessions: list });
  });

  router.delete('/api/sessions/:id', (req, res, ctx) => {
    const revoked = sessions.revoke(ctx.params.id, `revogado por ${ctx.user?.name ?? '?'}`);
    const headers =
      ctx.params.id === ctx.sessionId ? { 'set-cookie': clearCookie({ secure: cookieSecureFor(req) }) } : {};
    sendJson(res, 200, { revoked }, headers);
  });

  // Reset geral: derruba todo mundo, inclusive quem pediu. Por ser
  // destrutivo, exige a senha da casa de novo, nao so estar logado.
  router.post('/api/sessions/revoke-all', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    if (!config.authDisabled && !checkPassword(body.password, config.password)) {
      sendJson(res, 401, { error: 'Senha incorreta.' });
      return;
    }
    const count = sessions.revokeAll(`reset geral por ${ctx.user?.name ?? '?'}`);
    sendJson(res, 200, { revoked: count }, { 'set-cookie': clearCookie({ secure: cookieSecureFor(req) }) });
  });

  /* --------------------------------------------------------- estado ---- */

  // Uma única chamada entrega tudo que a tela inicial precisa.
  router.get('/api/state', (req, res, ctx) => {
    const current = store.ensureCurrentList(ctx.user?.name ?? null);
    sendJson(res, 200, {
      user: { name: ctx.user?.name ?? null },
      current: store.listWithItems(current.id),
      openLists: store.listSummaries({ status: 'open', limit: 50 }),
      historyCount: store.countLists('finished'),
    });
  });

  router.get('/api/lists', (req, res, ctx) => {
    const status = ctx.url.searchParams.get('status') || 'all';
    const limit = Number(ctx.url.searchParams.get('limit') || 50);
    const offset = Number(ctx.url.searchParams.get('offset') || 0);
    if (!['open', 'finished', 'all'].includes(status)) {
      sendJson(res, 400, { error: 'Filtro inválido.' });
      return;
    }
    sendJson(res, 200, {
      lists: store.listSummaries({ status, limit, offset }),
      total: store.countLists(status),
    });
  });

  router.post('/api/lists', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    const list = store.createList({
      name: body.name,
      author: ctx.user?.name ?? null,
      makeCurrent: Boolean(body.makeCurrent),
    });
    pushLists(ctx);
    pushList(ctx, list.id);
    sendJson(res, 201, { list: store.listWithItems(list.id) });
  });

  router.get('/api/lists/:id', (req, res, ctx) => {
    const list = store.listWithItems(ctx.params.id);
    if (!list) {
      sendJson(res, 404, { error: 'Lista não encontrada.' });
      return;
    }
    sendJson(res, 200, { list });
  });

  router.patch('/api/lists/:id', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    let list = store.requireList(ctx.params.id);
    if (body.name !== undefined) list = store.renameList(list.id, body.name);
    if (body.isCurrent === true) store.setCurrentList(list.id);
    pushLists(ctx);
    pushList(ctx, list.id);
    sendJson(res, 200, { list: store.listWithItems(list.id) });
  });

  router.post('/api/lists/:id/finish', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    const result = store.finishList(ctx.params.id, {
      author: ctx.user?.name ?? null,
      carryOver: body.carryOver !== false,
      nextName: body.nextName,
    });
    pushLists(ctx);
    pushList(ctx, result.finished.id);
    if (result.current) pushList(ctx, result.current.id);
    sendJson(res, 200, {
      finished: store.listWithItems(result.finished.id),
      current: result.current ? store.listWithItems(result.current.id) : null,
    });
  });

  router.post('/api/lists/:id/reopen', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    const result = store.reopenList(ctx.params.id, {
      makeCurrent: Boolean(body.makeCurrent),
      author: ctx.user?.name ?? null,
    });
    pushLists(ctx);
    pushList(ctx, result.list.id);
    sendJson(res, 200, {
      list: store.listWithItems(result.list.id),
      current: store.listWithItems(result.current.id),
    });
  });

  router.delete('/api/lists/:id', (req, res, ctx) => {
    const result = store.deleteList(ctx.params.id, { author: ctx.user?.name ?? null });
    hub.broadcast('list:removed', { listId: result.deletedId, origin: ctx.clientId });
    pushLists(ctx);
    pushList(ctx, result.current.id);
    sendJson(res, 200, { deletedId: result.deletedId, current: store.listWithItems(result.current.id) });
  });

  router.post('/api/lists/:id/copy', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    const target = String(body.targetListId || '');
    const result = store.copyItems(ctx.params.id, target, {
      onlyPending: body.onlyPending !== false,
      author: ctx.user?.name ?? null,
    });
    pushLists(ctx);
    pushList(ctx, result.listId);
    sendJson(res, 200, { copied: result.copied, list: store.listWithItems(result.listId) });
  });

  /* ----------------------------------------------------------- itens ---- */

  router.post('/api/lists/:id/items', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    const author = ctx.user?.name ?? null;
    let created;
    if (Array.isArray(body.names) || (typeof body.name === 'string' && body.name.includes('\n'))) {
      created = store.addItems(ctx.params.id, body.names ?? body.name, { author });
    } else {
      created = [
        store.addItem(ctx.params.id, {
          name: body.name,
          qty: body.qty,
          url: body.url,
          note: body.note,
          author,
        }),
      ];
    }
    pushList(ctx, ctx.params.id);
    pushLists(ctx);
    sendJson(res, 201, { items: created, list: store.listWithItems(ctx.params.id) });
  });

  router.patch('/api/items/:id', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    const item = store.updateItem(ctx.params.id, body, { author: ctx.user?.name ?? null });
    pushList(ctx, item.listId);
    pushLists(ctx);
    sendJson(res, 200, { item });
  });

  router.delete('/api/items/:id', (req, res, ctx) => {
    const result = store.deleteItem(ctx.params.id);
    pushList(ctx, result.listId);
    pushLists(ctx);
    sendJson(res, 200, result);
  });

  router.post('/api/lists/:id/reorder', async (req, res, ctx) => {
    const body = await readJsonBody(req);
    const items = store.reorderItems(ctx.params.id, body.itemIds);
    pushList(ctx, ctx.params.id);
    sendJson(res, 200, { items });
  });

  router.post('/api/lists/:id/clear-checked', (req, res, ctx) => {
    const result = store.clearChecked(ctx.params.id);
    pushList(ctx, ctx.params.id);
    pushLists(ctx);
    sendJson(res, 200, { ...result, list: store.listWithItems(ctx.params.id) });
  });

  router.post('/api/lists/:id/uncheck-all', (req, res, ctx) => {
    store.uncheckAll(ctx.params.id);
    pushList(ctx, ctx.params.id);
    pushLists(ctx);
    sendJson(res, 200, { list: store.listWithItems(ctx.params.id) });
  });

  router.get('/api/suggestions', (req, res, ctx) => {
    const query = ctx.url.searchParams.get('q') || '';
    const limit = Number(ctx.url.searchParams.get('limit') || 8);
    const exclude = ctx.url.searchParams.get('excludeListId');
    sendJson(res, 200, { suggestions: store.suggestions(query, limit, exclude) });
  });

  router.get('/api/stats', (req, res) => {
    sendJson(res, 200, { ...store.stats(), connected: hub.size });
  });

  /* ------------------------------------------------------ tempo real ---- */

  router.get('/api/events', (req, res, ctx) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // impede o nginx de segurar o stream
    });
    hub.add(res, { name: ctx.user?.name ?? null });
    res.write(`event: message\ndata: ${JSON.stringify({ type: 'hello', at: new Date().toISOString() })}\n\n`);
  });

  /* --------------------------------------------------------- handler ---- */

  async function handler(req, res) {
    aplicarCabecalhosDeSeguranca(req, res, config);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/{2,}/g, '/');

    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
      return;
    }

    if (pathname.startsWith('/api/')) {
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const mutating = method !== 'GET';
      if (mutating && !originAllowed(req)) {
        sendJson(res, 403, { error: 'Origem não permitida.' });
        return;
      }

      const match = router.match(method, pathname);
      if (!match) {
        sendJson(res, 404, { error: 'Rota não encontrada.' });
        return;
      }
      if (match.methodMismatch) {
        sendJson(res, 405, { error: 'Método não permitido.' });
        return;
      }

      const cookies = parseCookies(req.headers.cookie || '');
      const activeSession = sessions.getSession(cookies[COOKIE_NAME]);
      const user = activeSession
        ? { name: activeSession.userName }
        : config.authDisabled
          ? { name: 'Convidado' }
          : null;
      const ctx = {
        url,
        user,
        params: match.params,
        clientId: String(req.headers['x-client-id'] || ''),
        sessionId: activeSession?.id ?? null,
      };

      if (!user && !match.public) {
        sendJson(res, 401, { error: 'Entre com a senha da casa.' });
        return;
      }

      // Sessao renovada a cada visita: o cookie so tem prazo por limite do
      // proprio navegador (ver auth.js), na pratica nao expira sozinho para
      // quem usa o app com alguma frequencia. Rotas publicas que emitem seu
      // proprio cookie (login, convite) sobrescrevem isto na resposta.
      if (ctx.sessionId) {
        sessions.touchSession(ctx.sessionId);
        res.setHeader('set-cookie', sessionCookie(ctx.sessionId, { secure: cookieSecureFor(req) }));
      }

      try {
        await match.handler(req, res, ctx);
      } catch (error) {
        if (error instanceof ValidationError || error.status) {
          sendJson(res, error.status || 400, { error: error.message });
          return;
        }
        console.error('[erro]', pathname, error);
        sendJson(res, 500, { error: 'Erro interno do servidor.' });
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Método não permitido');
      return;
    }

    try {
      if (await serveStatic(req, res, pathname)) return;
      // SPA: qualquer rota desconhecida devolve o app shell.
      if (await serveStatic(req, res, '/index.html')) return;
      sendText(res, 404, 'Não encontrado');
    } catch (error) {
      console.error('[estático]', pathname, error);
      if (!res.headersSent) sendText(res, 500, 'Erro interno');
      else res.end();
    }
  }

  return {
    handler,
    store,
    hub,
    close() {
      hub.closeAll();
    },
  };
}
