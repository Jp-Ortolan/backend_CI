/**
 * fix/compatibilidade-telas-legadas — o que as telas antigas do front chamam e
 * o back não atendia: excluir representante, encerrar vínculo sem data e o
 * dashboard do representante no formato que a tela lê.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fecharPool } from '@/infraestrutura/banco/pool.js';
import { excluirRepresentante } from '@/aplicacao/representantes/excluir-representante.js';
import { encerrarVinculo } from '@/aplicacao/vinculos/encerrar-vinculo.js';
import { listarInstituicoes } from '@/aplicacao/instituicoes/listar-instituicoes.js';

const URL_APP = process.env.DATABASE_URL ?? '';
const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? '';
const rodar = URL_APP.length > 0 && URL_ADMIN.length > 0;
const MARCA = `l${Date.now()}`;
const HOJE = new Date().toISOString().slice(0, 10);

/** @type {pg.Client} */ let db;
/** @type {any} */ let admin; /** @type {any} */ let diretoria;
/** @type {string} */ let inst;

/** @param {string} c */
const codigo = (c) => (/** @type {any} */ e) => e.codigo === c;

before(async () => {
  if (!rodar) return;
  db = new pg.Client({ connectionString: URL_ADMIN });
  await db.connect();
  /** @param {string} papel */
  const usuario = async (papel) => (await db.query(
    `insert into usuario (nome, email, papel) values ($1, $2, $3)
     returning id, nome, email, papel, ativo, instituicao_id as "instituicaoId", pessoa_id as "pessoaId"`,
    [`L ${papel}`, `${papel}.${MARCA}@exemplo.br`, papel])).rows[0];
  admin = await usuario('admin');
  diretoria = await usuario('diretoria');
  inst = (await db.query(
    `insert into instituicao (nome, status, data_entrada) values ($1, 'ativa', '2020-01-01') returning id`,
    [`Legado ${MARCA}`])).rows[0].id;
});

after(async () => {
  if (!rodar) return;
  await db.end();
  await fecharPool();
});

/** @param {string} nome */
async function pessoaComVinculo(nome) {
  const p = (await db.query('insert into pessoa (nome) values ($1) returning id', [nome])).rows[0].id;
  const v = (await db.query(
    `insert into vinculo (pessoa_id, instituicao_id, data_inicio) values ($1, $2, '2024-01-01') returning id`,
    [p, inst])).rows[0].id;
  return { p, v };
}

describe('excluir representante', { skip: !rodar }, () => {
  test('cadastro por engano sai, com o vínculo junto', async () => {
    const { p } = await pessoaComVinculo(`Engano ${MARCA}`);
    const r = await excluirRepresentante(admin, p);
    assert.equal(r.excluido, true);
    const { rowCount } = await db.query('select 1 from vinculo where pessoa_id = $1', [p]);
    assert.equal(rowCount, 0);
  });

  test('quem tem presença não sai (409) e o histórico fica', async () => {
    const { p, v } = await pessoaComVinculo(`Histórico ${MARCA}`);
    const r = (await db.query(
      `insert into reuniao (titulo, data, status) values ('R', '2025-01-10', 'encerrada') returning id`)).rows[0].id;
    await db.query(
      `insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id, status, origem, horario_checkin)
       values ($1, $2, $3, $4, 'presente', 'manual', now())`, [r, p, v, inst]);
    await assert.rejects(() => excluirRepresentante(admin, p), codigo('PESSOA_COM_HISTORICO'));
    // Nem pelo banco direto: a trigger da 012 segura.
    await assert.rejects(() => db.query('delete from pessoa where id = $1', [p]), /PESSOA_COM_HISTORICO/);
  });

  test('Diretoria não exclui definitivamente', async () => {
    const { p } = await pessoaComVinculo(`Dir ${MARCA}`);
    await assert.rejects(() => excluirRepresentante(diretoria, p), codigo('SEM_PERMISSAO'));
  });
});

describe('encerrar vínculo pela tela', { skip: !rodar }, () => {
  test('corpo vazio encerra hoje', async () => {
    const { v } = await pessoaComVinculo(`Encerra ${MARCA}`);
    const r = await encerrarVinculo(diretoria, v, {});
    assert.equal(r.status, 'encerrado');
    assert.equal(r.dataFim, HOJE);
  });
});

describe('listagem de instituições', { skip: !rodar }, () => {
  test('traz vertente, GTs e situação da adesão para os filtros da tela', async () => {
    const r = await listarInstituicoes(diretoria, { busca: MARCA });
    const i = r.dados.find((x) => x.id === inst);
    assert.ok(Array.isArray(i.gts));
    assert.equal(i.situacaoAdesao, 'aprovada');
  });
});
