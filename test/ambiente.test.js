import test from 'node:test';
import assert from 'node:assert/strict';
import { versaoSuficiente, versaoMinima } from '../server/verifica-ambiente.js';

test('aceita as versões do Node em que o node:sqlite funciona sem flag', () => {
  for (const versao of ['22.13.0', 'v22.13.0', '22.13.1', '22.22.2', '23.4.0', '24.0.0', '30.1.2']) {
    assert.equal(versaoSuficiente(versao), true, `${versao} deveria ser aceita`);
  }
});

test('recusa as versões em que o node:sqlite exigia flag ou nem existia', () => {
  for (const versao of ['18.20.4', '20.11.0', '22.0.0', '22.5.0', '22.12.0', '21.7.3']) {
    assert.equal(versaoSuficiente(versao), false, `${versao} deveria ser recusada`);
  }
});

test('a versão mínima documentada é a que o código exige', () => {
  assert.equal(versaoMinima, '22.13.0');
  assert.equal(versaoSuficiente(versaoMinima), true);
});
