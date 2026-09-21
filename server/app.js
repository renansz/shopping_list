import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, ValidationError } from './store.js';
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
import {
  LoginThrottle,
  COOKIE_NAME,
  checkPassword,
  clearCookie,
  createToken,
  parseCookies,
  resolveSecret,
  sessionCookie,
  verifyToken,
} from './auth.js';

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
  const hub = new EventHub();
  const secret = resolveSecret(db, config.sessionSecret);
  const throttle = new LoginThrottle();
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
      appName: config.appName,
    });
  });

  router.post('/api/login', async (req, res, ctx) => {
    const ip = clientIp(req, config.trustProxy);
    if (!throttle.check(ip)) {
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
      throttle.fail(ip);
      sendJson(res, 401, { error: 'Senha incorreta.' });
      return;
    }
    throttle.reset(ip);
    const expiresAt = Date.now() + config.sessionDays * 24 * 60 * 60 * 1000;
    const token = createToken({ name, iat: Date.now(), exp: expiresAt }, secret);
    sendJson(
      res,
      200,
      { ok: true, user: { name } },
      { 'set-cookie': sessionCookie(token, { secure: cookieSecureFor(req), days: config.sessionDays }) },
    );
  });

  router.post('/api/logout', (req, res) => {
    sendJson(res, 200, { ok: true }, { 'set-cookie': clearCookie({ secure: cookieSecureFor(req) }) });
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

  const PUBLIC_ROUTES = new Set(['/api/me', '/api/login', '/api/logout', '/api/health']);

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

      const cookies = parseCookies(req.headers.cookie || '');
      const session = verifyToken(cookies[COOKIE_NAME], secret);
      const user = session
        ? { name: session.name }
        : config.authDisabled
          ? { name: 'Convidado' }
          : null;
      const ctx = {
        url,
        user,
        params: {},
        clientId: String(req.headers['x-client-id'] || ''),
      };

      if (!user && !PUBLIC_ROUTES.has(pathname)) {
        sendJson(res, 401, { error: 'Entre com a senha da casa.' });
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
      ctx.params = match.params;
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
