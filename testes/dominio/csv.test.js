/**
 * A exportação CSV é o "Excel" do sistema: precisa abrir certo no Excel
 * em português e não pode virar fórmula na máquina de quem abre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarCsv } from '../../src/infraestrutura/http/csv.js';

const colunas = [{ chave: 'nome', titulo: 'Nome' }, { chave: 'pct', titulo: 'Percentual' }];

test('começa com BOM e usa ponto e vírgula', () => {
  const csv = gerarCsv(colunas, [{ nome: 'Universidade Alfa', pct: 87.5 }]);
  assert.ok(csv.startsWith('﻿Nome;Percentual\r\n'));
  assert.ok(csv.includes('Universidade Alfa;87.5'));
});

test('célula com ponto e vírgula, aspas ou quebra de linha vai entre aspas', () => {
  const csv = gerarCsv(colunas, [{ nome: 'A; "B"\nC', pct: null }]);
  assert.ok(csv.includes('"A; ""B""\nC";'));
});

test('fórmula vira texto (injeção de CSV)', () => {
  const csv = gerarCsv(colunas, [{ nome: '=HYPERLINK("http://x")', pct: '-1' }]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(csv.includes(";'-1"));
});
