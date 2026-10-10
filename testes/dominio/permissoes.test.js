/**
 * Testes da matriz de permissões (RF03), revista para os perfis do Fórum.
 *
 * O que estes testes protegem: a tabela "Estrutura de acessos recomendada" da
 * revisão de outubro. Admin faz tudo; Diretoria opera e aprova mas não exclui
 * nem mexe em contas; representante consulta, cuida da própria instituição e
 * PEDE o resto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pode, acoesDe, menuDoPapel, permissoesDe, ehGestao, escopoDe, ROTULO_PAPEL,
} from '../../src/dominio/permissoes.js';

test('admin pode tudo sobre instituição, inclusive excluir e aprovar', () => {
  for (const a of ['ver', 'criar', 'editar', 'encerrar', 'excluir', 'exportar', 'aprovar']) {
    assert.equal(pode('admin', 'instituicao', a), true, `admin deveria poder ${a}`);
  }
});

test('só o admin gerencia contas e permissões', () => {
  assert.equal(pode('admin', 'usuario', 'criar'), true);
  assert.equal(pode('diretoria', 'usuario', 'ver'), false);
  assert.equal(pode('representante', 'usuario', 'ver'), false);
});

test('diretoria cria reuniões e eventos, aprova e corrige presença', () => {
  assert.equal(pode('diretoria', 'reuniao', 'criar'), true);
  assert.equal(pode('diretoria', 'evento', 'criar'), true);
  assert.equal(pode('diretoria', 'solicitacao', 'aprovar'), true);
  assert.equal(pode('diretoria', 'instituicao', 'aprovar'), true);
  assert.equal(pode('diretoria', 'presenca', 'editar'), true);
});

test('diretoria não exclui definitivamente', () => {
  for (const r of ['instituicao', 'vinculo', 'reuniao', 'evento', 'documento']) {
    assert.equal(pode('diretoria', r, 'excluir'), false, `diretoria não deveria excluir ${r}`);
  }
});

test('representante não cria reunião nem evento, não aprova, não corrige presença', () => {
  assert.equal(pode('representante', 'reuniao', 'criar'), false);
  assert.equal(pode('representante', 'evento', 'editar'), false);
  assert.equal(pode('representante', 'solicitacao', 'aprovar'), false);
  assert.equal(pode('representante', 'instituicao', 'aprovar'), false);
  assert.equal(pode('representante', 'presenca', 'editar'), false);
});

test('representante edita a própria instituição, anexa documento e abre solicitação', () => {
  assert.equal(pode('representante', 'instituicao', 'editar'), true);
  assert.equal(pode('representante', 'documento', 'criar'), true);
  assert.equal(pode('representante', 'solicitacao', 'criar'), true);
  assert.equal(pode('representante', 'relatorio', 'exportar'), true);
  assert.equal(pode('representante', 'instituicao', 'excluir'), false);
});

test('sem papel não pode nada', () => {
  assert.equal(pode(null, 'instituicao', 'ver'), false);
  assert.equal(pode(undefined, 'indicador', 'ver'), false);
  assert.equal(pode(/** @type {any} */ ('gestor'), 'instituicao', 'ver'), false,
    'papel antigo não pode continuar valendo');
});

test('os três perfis enxergam menus DIFERENTES', () => {
  const admin = menuDoPapel('admin').map((i) => i.href);
  const diretoria = menuDoPapel('diretoria').map((i) => i.href);
  const repr = menuDoPapel('representante').map((i) => i.href);

  assert.ok(admin.includes('/usuarios'));
  assert.equal(diretoria.includes('/usuarios'), false);
  assert.ok(diretoria.includes('/solicitacoes'));
  assert.ok(repr.includes('/minha-instituicao'));
  assert.equal(repr.includes('/representantes'), false);
  assert.equal(repr.includes('/relatorios'), false);
  assert.notDeepEqual(admin, diretoria);
  assert.notDeepEqual(diretoria, repr);
});

test('reuniões e eventos são itens separados no menu', () => {
  for (const p of /** @type {const} */ (['admin', 'diretoria', 'representante'])) {
    const itens = menuDoPapel(p).map((i) => i.href);
    assert.ok(itens.includes('/reunioes') && itens.includes('/eventos'), p);
  }
});

test('escopo: gestão vê tudo, representante só a instituição', () => {
  assert.equal(ehGestao('admin'), true);
  assert.equal(ehGestao('diretoria'), true);
  assert.equal(ehGestao('representante'), false);
  assert.equal(escopoDe('diretoria'), 'tudo');
  assert.equal(escopoDe('representante'), 'instituicao');
});

test('acoesDe e permissoesDe devolvem cópia — mutar não contamina a matriz', () => {
  const a = acoesDe('representante', 'instituicao');
  a.push('excluir');
  const m = permissoesDe('representante');
  m.instituicao.push('aprovar');
  assert.equal(pode('representante', 'instituicao', 'excluir'), false);
  assert.equal(pode('representante', 'instituicao', 'aprovar'), false);
});

test('todo papel tem rótulo de exibição', () => {
  for (const p of ['admin', 'diretoria', 'representante']) {
    assert.ok(ROTULO_PAPEL[p] && ROTULO_PAPEL[p].length > 0);
  }
});
