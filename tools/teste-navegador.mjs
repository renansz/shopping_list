/**
 * Teste de ponta a ponta num navegador de verdade.
 *
 * Diferente do `npm test`, este script é opcional: ele precisa do Playwright,
 * que NÃO é dependência do projeto (a aplicação continua sem dependências).
 *
 *   npm i -g playwright && npx playwright install chromium
 *   node tools/teste-navegador.mjs                    # sobe um servidor próprio
 *   node tools/teste-navegador.mjs http://localhost:3000 senha
 *
 * Cobre o que os testes de API não alcançam: interface, tempo real entre dois
 * aparelhos e a fila offline.
 */
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { readConfig } from '../server/config.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'Playwright não encontrado. Instale com:\n' +
      '  npm i -g playwright && npx playwright install chromium\n' +
      '(o projeto em si continua sem dependências)',
  );
  process.exit(1);
}

const SENHA = process.argv[3] || 'teste-navegador';
let base = process.argv[2];
let parar = async () => {};

if (!base) {
  const config = { ...readConfig({ HOUSEHOLD_PASSWORD: SENHA, SESSION_SECRET: 'teste' }), dbFile: ':memory:' };
  const db = openDatabase(':memory:');
  const app = createApp({ config, db });
  const server = http.createServer(app.handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  parar = async () => {
    app.close();
    server.close();
    await once(server, 'close');
  };
  console.log(`servidor de teste em ${base}\n`);
}

let falhas = 0;
function conferir(descricao, condicao) {
  console.log(`${condicao ? '  ok  ' : ' FALHA'}  ${descricao}`);
  if (!condicao) falhas += 1;
}

const browser = await chromium.launch();
const celular = { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true };

async function entrar(context, nome) {
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    console.log(`  FALHA  erro de JavaScript: ${error.message}`);
    falhas += 1;
  });
  await page.goto(base);
  await page.fill('#login-name', nome);
  await page.fill('#login-pass', SENHA);
  await page.click('button[type=submit]');
  await page.waitForSelector('.composer__input');
  return page;
}

async function adicionar(page, nome) {
  await page.fill('.composer__input', nome);
  await page.click('.composer__send');
  await page.waitForTimeout(250);
}

try {
  const ctxRenan = await browser.newContext(celular);
  const renan = await entrar(ctxRenan, 'Renan');
  conferir('entra com a senha da casa e vê a lista atual', (await renan.locator('.topbar h1').count()) === 1);

  await adicionar(renan, 'Arroz');
  await adicionar(renan, 'Café');
  conferir('adiciona itens', (await renan.locator('.item').count()) === 2);

  await renan.locator('.item__check').first().click();
  await renan.waitForTimeout(300);
  conferir('marca item como comprado', (await renan.locator('.item--checked').count()) === 1);

  // Item de compra online, com link.
  await renan.click('.composer__toggle');
  await renan.fill('.composer__input', 'Fone bluetooth');
  await renan.fill('.composer__extra input[inputmode=url]', 'loja.com/fone');
  await renan.click('.composer__send');
  await renan.waitForTimeout(400);
  conferir('item com link vira atalho para a loja', (await renan.locator('.item__link').count()) === 1);

  // Segundo aparelho: tempo real.
  const ctxAna = await browser.newContext(celular);
  const ana = await entrar(ctxAna, 'Ana');
  await adicionar(ana, 'Chocolate');
  await renan.waitForTimeout(1200);
  conferir(
    'item da Ana aparece sozinho no aparelho do Renan',
    (await renan.locator('.item__name', { hasText: 'Chocolate' }).count()) === 1,
  );

  // Um item que ainda ninguém marcou, para a contagem ser previsível.
  await ana.locator('.item', { hasText: 'Café' }).locator('.item__check').click();
  await renan.waitForTimeout(1200);
  conferir('marcação da Ana chega em tempo real', (await renan.locator('.item--checked').count()) === 2);

  // Finalizar a lista.
  await renan.click('text=Finalizar lista');
  await renan.waitForTimeout(500);
  await renan.click('.sheet button.btn--primary');
  await renan.waitForTimeout(1000);
  // Sobraram "Fone bluetooth" e "Chocolate": Arroz e Café foram comprados.
  conferir('lista nova entra no lugar com os pendentes', (await renan.locator('.item').count()) === 2);

  await renan.goto(`${base}/#/historico`);
  await renan.waitForTimeout(800);
  conferir('lista finalizada aparece no histórico', (await renan.locator('.listcard').count()) === 1);

  await renan.locator('.listcard').first().click();
  await renan.waitForTimeout(800);
  conferir('lista do histórico abre só para leitura', (await renan.locator('.composer:not([hidden])').count()) === 0);

  // Offline.
  await renan.goto(`${base}/#/`);
  await renan.waitForTimeout(600);
  await ctxRenan.setOffline(true);
  await renan.reload();
  await renan.waitForTimeout(1500);
  conferir('app abre sem internet', (await renan.locator('.item').count()) > 0);
  conferir('avisa que está offline', (await renan.locator('.offlinebar').count()) === 1);

  await adicionar(renan, 'Item anotado sem sinal');
  conferir(
    'item anotado offline aparece na hora',
    (await renan.locator('.item__name', { hasText: 'sem sinal' }).count()) === 1,
  );
  conferir(
    'alteração fica guardada na fila',
    (await renan.evaluate(() => JSON.parse(localStorage.getItem('sl_outbox_v1') || '[]').length)) > 0,
  );

  await ctxRenan.setOffline(false);
  await renan.evaluate(() => window.dispatchEvent(new Event('online')));
  await renan.waitForTimeout(2500);
  conferir(
    'fila esvazia quando a conexão volta',
    (await renan.evaluate(() => JSON.parse(localStorage.getItem('sl_outbox_v1') || '[]').length)) === 0,
  );
  const nomes = await renan.evaluate(async () => {
    const estado = await fetch('/api/state').then((r) => r.json());
    return estado.current.items.map((item) => item.name);
  });
  conferir('o que foi anotado offline chegou ao servidor', nomes.some((nome) => nome.includes('sem sinal')));

  // PWA.
  const temServiceWorker = await renan.evaluate(async () => {
    const registro = await navigator.serviceWorker.ready;
    return Boolean(registro.active);
  });
  conferir('service worker ativo (instala como app)', temServiceWorker);
  const manifesto = await renan.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.json()));
  conferir('manifest em modo standalone com ícones', manifesto.display === 'standalone' && manifesto.icons.length >= 4);
} finally {
  await browser.close();
  await parar();
}

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} verificação(ões) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
