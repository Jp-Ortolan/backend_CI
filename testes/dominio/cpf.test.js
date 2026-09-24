import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, formatarCpf, apenasDigitos } from '../../src/dominio/cpf.js';

test('aceita CPF válido com e sem pontuação', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('52998224725'), true);
  assert.equal(cpfValido('111.444.777-35'), true);
});

test('recusa dígito verificador errado', () => {
  assert.equal(cpfValido('529.982.247-26'), false);
  assert.equal(cpfValido('111.444.777-34'), false);
});

test('recusa os onze dígitos iguais', () => {
  // Passam na conta por coincidência: se este teste falhar, a recusa manual saiu.
  for (const d of '0123456789') assert.equal(cpfValido(d.repeat(11)), false, `${d.repeat(11)}`);
});

test('recusa tamanho errado, vazio e nulo', () => {
  assert.equal(cpfValido('5299822472'), false);
  assert.equal(cpfValido('529982247250'), false);
  assert.equal(cpfValido(''), false);
  assert.equal(cpfValido(null), false);
  assert.equal(cpfValido(undefined), false);
});

test('recusa CNPJ no lugar de CPF', () => {
  assert.equal(cpfValido('11.222.333/0001-81'), false);
});

test('normaliza e formata', () => {
  assert.equal(apenasDigitos('529.982.247-25'), '52998224725');
  assert.equal(formatarCpf('52998224725'), '529.982.247-25');
  assert.equal(formatarCpf('123'), '123');
});
