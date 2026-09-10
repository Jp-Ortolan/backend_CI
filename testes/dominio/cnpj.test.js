/**
 * Testes do CNPJ — puros, sem banco. Rodam com `npm run test:dominio`.
 *
 * O banco só garante "14 dígitos". Quem recusa 11111111111111 e quem recusa um
 * dígito verificador trocado é este módulo, então é aqui que isso se prova.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apenasDigitos, cnpjValido, formatarCnpj, cepValido } from '../../src/dominio/cnpj.js';

test('aceita CNPJ válido com e sem pontuação', () => {
  // CNPJ real da Receita usado como exemplo em documentação pública.
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11222333000181'), true);
  assert.equal(cnpjValido(' 11222333000181 '), true);
});

test('recusa CNPJ com dígito verificador errado', () => {
  assert.equal(cnpjValido('11222333000182'), false, 'último dígito trocado');
  assert.equal(cnpjValido('11222333000171'), false, 'penúltimo dígito trocado');
});

test('recusa os repetidos, que passariam na conta por coincidência', () => {
  for (const n of ['00000000000000', '11111111111111', '99999999999999']) {
    assert.equal(cnpjValido(n), false, `${n} não é CNPJ`);
  }
});

test('recusa tamanho errado, vazio e nulo', () => {
  assert.equal(cnpjValido('112223330001'), false, 'curto demais');
  assert.equal(cnpjValido('112223330001812'), false, 'longo demais');
  assert.equal(cnpjValido(''), false);
  assert.equal(cnpjValido(null), false);
  assert.equal(cnpjValido(undefined), false);
});

test('apenasDigitos limpa a máscara da tela', () => {
  assert.equal(apenasDigitos('11.222.333/0001-81'), '11222333000181');
  assert.equal(apenasDigitos('(42) 3633-3333'), '4236333333');
  assert.equal(apenasDigitos(null), '');
});

test('formatarCnpj devolve a máscara e não estraga entrada inválida', () => {
  assert.equal(formatarCnpj('11222333000181'), '11.222.333/0001-81');
  // Entrada torta volta como veio: formatar não é lugar de esconder problema.
  assert.equal(formatarCnpj('123'), '123');
});

test('CEP exige exatamente 8 dígitos', () => {
  assert.equal(cepValido('85000-000'), true);
  assert.equal(cepValido('85000000'), true);
  assert.equal(cepValido('8500000'), false);
  assert.equal(cepValido(''), false);
});
