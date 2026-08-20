/**
 * Testes da matriz de permissões (RF03).
 *
 * O que estes testes protegem: a regra de que gestor opera mas não apaga, e
 * que consulta não escreve nada. Quebrar isso em silêncio é o caminho mais
 * curto para alguém apagar um vínculo e levar o histórico de participação junto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pode, acoesDe, menuDoPapel, ROTULO_PAPEL } from '../lib/dominio/permissoes';

test('admin pode tudo sobre instituição', () => {
  for (const a of ['ver','criar','editar','encerrar','excluir','exportar'] as const) {
    assert.equal(pode('admin', 'instituicao', a), true, `admin deveria poder ${a}`);
  }
});

test('gestor opera mas não exclui', () => {
  assert.equal(pode('gestor', 'instituicao', 'criar'), true);
  assert.equal(pode('gestor', 'instituicao', 'editar'), true);
  assert.equal(pode('gestor', 'reuniao', 'encerrar'), true);
  assert.equal(pode('gestor', 'instituicao', 'excluir'), false);
  assert.equal(pode('gestor', 'vinculo', 'excluir'), false);
});

test('gestor não administra usuários', () => {
  assert.equal(pode('gestor', 'usuario', 'ver'), false);
  assert.equal(pode('gestor', 'usuario', 'criar'), false);
});

test('consulta só lê', () => {
  assert.equal(pode('leitura', 'instituicao', 'ver'), true);
  for (const a of ['criar','editar','encerrar','excluir','exportar'] as const) {
    assert.equal(pode('leitura', 'instituicao', a), false, `leitura não deveria poder ${a}`);
  }
});

test('consulta não enxerga usuários', () => {
  assert.equal(pode('leitura', 'usuario', 'ver'), false);
});

test('sem papel não pode nada', () => {
  assert.equal(pode(null, 'instituicao', 'ver'), false);
  assert.equal(pode(undefined, 'indicador', 'ver'), false);
});

test('menu do gestor esconde Usuários', () => {
  const itens = menuDoPapel('gestor').map(i => i.rotulo);
  assert.ok(itens.includes('Instituições'));
  assert.ok(itens.includes('Reuniões'));
  assert.equal(itens.includes('Usuários'), false);
});

test('menu do admin inclui Usuários', () => {
  assert.ok(menuDoPapel('admin').map(i => i.rotulo).includes('Usuários'));
});

test('menu da consulta é só leitura, sem Usuários', () => {
  const itens = menuDoPapel('leitura').map(i => i.rotulo);
  assert.equal(itens.includes('Usuários'), false);
  assert.ok(itens.includes('Dashboard'));
});

test('acoesDe devolve cópia — mutar não contamina a matriz', () => {
  const a = acoesDe('leitura', 'instituicao');
  a.push('excluir');
  assert.equal(pode('leitura', 'instituicao', 'excluir'), false);
});

test('todo papel tem rótulo de exibição', () => {
  for (const p of ['admin','gestor','leitura'] as const) {
    assert.ok(ROTULO_PAPEL[p] && ROTULO_PAPEL[p].length > 0);
  }
});
