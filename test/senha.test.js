import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import {
  GerenciadorDeSenha,
  TAMANHO_MINIMO,
  confereHash,
  geraHash,
  validaSenha,
} from '../server/senha.js';

function novoGerenciador(senhaDoAmbiente = 'senha-inicial') {
  return new GerenciadorDeSenha(openDatabase(':memory:'), senhaDoAmbiente);
}

test('hash confere a senha certa e recusa a errada', () => {
  const hash = geraHash('abacaxi-com-hortela');
  assert.equal(confereHash('abacaxi-com-hortela', hash), true);
  assert.equal(confereHash('abacaxi-com-hortelã', hash), false);
  assert.equal(confereHash('', hash), false);
});

test('cada hash tem sal próprio', () => {
  const a = geraHash('mesma-senha-aqui');
  const b = geraHash('mesma-senha-aqui');
  assert.notEqual(a, b, 'dois hashes da mesma senha não podem ser iguais');
  assert.equal(confereHash('mesma-senha-aqui', a), true);
  assert.equal(confereHash('mesma-senha-aqui', b), true);
});

test('hash corrompido recusa tudo em vez de liberar', () => {
  for (const ruim of ['', 'qualquer-coisa', 'scrypt$1$2$3', 'scrypt$x$y$z$aaa$bbb', null, undefined]) {
    assert.equal(confereHash('senha-boa-aqui', ruim), false);
  }
});

test('espaços nas pontas não contam (teclado de celular)', () => {
  const hash = geraHash('senha-da-familia');
  assert.equal(confereHash('  senha-da-familia  ', hash), true);
  assert.equal(confereHash('senha da familia', hash), false, 'espaço no meio continua valendo');
});

test('regras da senha nova', () => {
  assert.throws(() => validaSenha('curta'), new RegExp(String(TAMANHO_MINIMO)));
  assert.throws(() => validaSenha('aaaaaaaaaa'), /óbvia/);
  assert.throws(() => validaSenha('a'.repeat(300)), /longa/);
  assert.equal(validaSenha('  compras-2026  '), 'compras-2026');
});

test('antes da troca vale a senha do ambiente; depois, não mais', () => {
  const senhas = novoGerenciador('senha-inicial');
  assert.equal(senhas.personalizada, false);
  assert.equal(senhas.confere('senha-inicial'), true);
  assert.equal(senhas.confere('outra-coisa'), false);

  senhas.define('nova-senha-da-casa', { por: 'Renan' });

  assert.equal(senhas.personalizada, true);
  assert.equal(senhas.confere('nova-senha-da-casa'), true);
  assert.equal(
    senhas.confere('senha-inicial'),
    false,
    'a senha antiga do ambiente não pode continuar entrando',
  );
});

test('guarda quem trocou e quando', () => {
  const senhas = novoGerenciador();
  const antes = Date.now();
  const info = senhas.define('outra-senha-boa', { por: 'Ana' });
  assert.equal(info.personalizada, true);
  assert.equal(info.atualizadaPor, 'Ana');
  assert.ok(new Date(info.atualizadaEm).getTime() >= antes - 1000);
  assert.equal(info.tamanhoMinimo, TAMANHO_MINIMO);
});

test('senha inválida não substitui a que já valia', () => {
  const senhas = novoGerenciador();
  senhas.define('senha-boa-atual');
  assert.throws(() => senhas.define('123'));
  assert.equal(senhas.confere('senha-boa-atual'), true, 'a senha anterior continua valendo');
});

test('sem senha no ambiente e sem senha no banco, nada entra', () => {
  const senhas = novoGerenciador('');
  assert.equal(senhas.confere(''), false);
  assert.equal(senhas.confere('qualquer'), false);
});
