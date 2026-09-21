import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { SessionStore } from '../server/sessions.js';
import { ValidationError } from '../server/store.js';

function newStore() {
  return new SessionStore(openDatabase(':memory:'));
}

test('cria e recupera sessao', () => {
  const sessions = newStore();
  const session = sessions.createSession('Renan', { createdVia: 'password' });
  assert.equal(session.userName, 'Renan');
  assert.equal(session.createdVia, 'password');
  assert.ok(sessions.getSession(session.id));
});

test('sessao revogada deixa de ser valida', () => {
  const sessions = newStore();
  const session = sessions.createSession('Renan');
  assert.ok(sessions.revoke(session.id, 'logout'));
  assert.equal(sessions.getSession(session.id), null);
  // revogar de novo nao da erro, so nao muda nada
  assert.equal(sessions.revoke(session.id, 'logout'), false);
});

test('sessao inexistente ou vazia nao quebra', () => {
  const sessions = newStore();
  assert.equal(sessions.getSession(null), null);
  assert.equal(sessions.getSession(''), null);
  assert.equal(sessions.getSession('nao-existe'), null);
});

test('listActive traz so as sessoes ativas, revogadas somem', () => {
  const sessions = newStore();
  const a = sessions.createSession('Renan');
  const b = sessions.createSession('Ana');
  assert.equal(sessions.listActive().length, 2);
  sessions.revoke(a.id);
  const ativas = sessions.listActive();
  assert.equal(ativas.length, 1);
  assert.equal(ativas[0].id, b.id);
});

test('revokeAll derruba todo mundo de uma vez', () => {
  const sessions = newStore();
  sessions.createSession('Renan');
  sessions.createSession('Ana');
  const total = sessions.revokeAll('reset geral');
  assert.equal(total, 2);
  assert.equal(sessions.listActive().length, 0);
});

test('convite exige nome', () => {
  const sessions = newStore();
  assert.throws(() => sessions.createInvite('   '), ValidationError);
});

test('convite valido pode ser consultado varias vezes sem se gastar', () => {
  const sessions = newStore();
  const invite = sessions.createInvite('Ana', { createdBy: 'Renan' });
  const primeira = sessions.getInvite(invite.id);
  const segunda = sessions.getInvite(invite.id);
  assert.deepEqual(primeira, { valid: true, name: 'Ana' });
  assert.deepEqual(segunda, { valid: true, name: 'Ana' });
});

test('consumir o convite cria a sessao e o gasta - so funciona uma vez', () => {
  const sessions = newStore();
  const invite = sessions.createInvite('Ana');
  const session = sessions.consumeInvite(invite.id);
  assert.equal(session.userName, 'Ana');
  assert.equal(session.createdVia, 'invite');
  assert.ok(sessions.getSession(session.id));

  assert.equal(sessions.getInvite(invite.id).valid, false);
  assert.throws(() => sessions.consumeInvite(invite.id), /já foi usado/);
});

test('convite expirado nao pode ser consumido', () => {
  const sessions = newStore();
  const invite = sessions.createInvite('Ana', { validDays: -1 });
  assert.equal(sessions.getInvite(invite.id).valid, false);
  assert.throws(() => sessions.consumeInvite(invite.id), /expirou/);
});

test('convite cancelado antes do uso nao pode ser consumido', () => {
  const sessions = newStore();
  const invite = sessions.createInvite('Ana');
  assert.ok(sessions.revokeInvite(invite.id));
  assert.throws(() => sessions.consumeInvite(invite.id), /cancelado/);
  // cancelar de novo, ou um ja usado, nao muda nada
  assert.equal(sessions.revokeInvite(invite.id), false);
});

test('listInvites so mostra convites ainda pendentes', () => {
  const sessions = newStore();
  const pendente = sessions.createInvite('Ana');
  const usado = sessions.createInvite('Beto');
  sessions.consumeInvite(usado.id);
  const cancelado = sessions.createInvite('Caio');
  sessions.revokeInvite(cancelado.id);

  const listados = sessions.listInvites();
  assert.equal(listados.length, 1);
  assert.equal(listados[0].id, pendente.id);
});
