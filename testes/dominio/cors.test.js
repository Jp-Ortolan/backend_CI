/**
 * A lista de origens do CORS é lida uma vez, no carregamento do módulo — por
 * isso cada caso importa de novo, com a variável já no lugar.
 *
 * Vale testar porque errar aqui para o lado permissivo libera qualquer site a
 * chamar a API com o cookie do usuário logado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** @param {string} valor */
async function comEnv(valor) {
  process.env.URL_FRONTEND = valor;
  // A query force o Node a reavaliar o módulo em vez de servir o do cache.
  const m = await import(`../../src/infraestrutura/http/front.js?${Math.random()}`);
  return m;
}

test('libera a origem única configurada', async () => {
  const { origemLiberada } = await comEnv('https://front.exemplo.br');
  assert.equal(origemLiberada('https://front.exemplo.br'), 'https://front.exemplo.br');
});

test('libera qualquer uma da lista', async () => {
  const { origemLiberada } = await comEnv('https://prod.br, http://localhost:5173');
  assert.equal(origemLiberada('https://prod.br'), 'https://prod.br');
  assert.equal(origemLiberada('http://localhost:5173'), 'http://localhost:5173');
});

test('recusa origem que não está na lista', async () => {
  const { origemLiberada } = await comEnv('https://prod.br');
  assert.equal(origemLiberada('https://site-do-atacante.br'), '');
  assert.equal(origemLiberada('http://prod.br'), '', 'http não é https');
  assert.equal(origemLiberada('https://prod.br.atacante.br'), '', 'não pode casar por prefixo');
  assert.equal(origemLiberada(null), '');
  assert.equal(origemLiberada(''), '');
});

test('barra no fim não muda o resultado', async () => {
  const { origemLiberada } = await comEnv('https://prod.br/');
  assert.equal(origemLiberada('https://prod.br'), 'https://prod.br');
});

test('urlDoFront devolve a primeira, que é a que vira link', async () => {
  const { urlDoFront } = await comEnv('https://prod.br, http://localhost:5173');
  assert.equal(urlDoFront(), 'https://prod.br');
});
