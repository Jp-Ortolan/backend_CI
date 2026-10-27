/**
 * Contrato /api/governanca — relatórios xlsx/pdf e importação em lote.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { fecharPool } from '@/infraestrutura/banco/pool.js';
import { verificar } from '@/infraestrutura/seguranca/assinatura.js';
import { gerarRelatorio, baixarRelatorio, celulaSegura } from '@/aplicacao/governanca/relatorios.js';
import {
  validarImportacao, confirmarImportacao, listarImportacoes, lerCsv,
} from '@/aplicacao/governanca/importacoes.js';
import { usuarioPorId } from '@/aplicacao/governanca/comum.js';

const { Client } = pg;
const rodar = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN;
/** @type {import('pg').Client} */ let db;
const MARCA = `r${Date.now()}`;
const BASE = 'https://api.exemplo.br';
// Ano só desta execução: o banco de teste acumula reuniões de execuções anteriores.
const ANO = 2040 + Math.floor(Math.random() * 900);

/** @type {any} */ let admin;
/** @type {any} */ let diretoria;
/** @type {any} */ let repr;
/** @type {string} */ let instA;
/** @type {string} */ let pessoaA;
/** @type {string} */ let reuniaoId;

/** CNPJ válido a partir de 12 dígitos. */
function cnpj(base12) {
  const d = base12.split('').map(Number);
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + p * d[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  d.push(dv(12)); d.push(dv(13));
  return d.join('');
}
const codigo = (c) => (/** @type {any} */ e) => {
  if (e.codigo !== c) console.error(e);
  return e.codigo === c;
};
const csv = (linhas) => ({ nome: 'dados.csv', conteudo: Buffer.from(linhas.join('\r\n'), 'utf8') });

before(async () => {
  if (!rodar) return;
  db = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
  await db.connect();
  instA = (await db.query(
    `insert into instituicao (nome, status, data_entrada, autoriza_divulgacao) values ($1, 'ativa', '2020-01-01', true) returning id`,
    [`=HYPERLINK("x") ${MARCA}`])).rows[0].id;
  pessoaA = (await db.query(`insert into pessoa (nome) values ($1) returning id`, [`Pessoa R ${MARCA}`])).rows[0].id;
  await db.query(`insert into vinculo (pessoa_id, instituicao_id, tipo_representacao, data_inicio) values ($1, $2, 'titular', '2020-01-01')`,
    [pessoaA, instA]);
  reuniaoId = (await db.query(
    `insert into reuniao (titulo, data, status, natureza, conta_participacao) values ($1, '${ANO}-05-10', 'encerrada', 'reuniao', true) returning id`,
    [`Reunião R ${MARCA}`])).rows[0].id;
  await db.query(
    `insert into presenca (reuniao_id, pessoa_id, instituicao_id, tipo, status, origem, horario_checkin)
     values ($1, $2, $3, 'representante', 'presente', 'manual', '${ANO}-05-10T12:00:00Z')`, [reuniaoId, pessoaA, instA]);
  const usuario = async (papel, instituicaoId, pessoaId = null) => (await db.query(
    `insert into usuario (nome, email, papel, instituicao_id, pessoa_id) values ($1, $2, $3, $4, $5)
     returning id, nome, email, papel, ativo, instituicao_id as "instituicaoId", pessoa_id as "pessoaId"`,
    [`Rel ${papel} ${MARCA}`, `${papel}.${Math.random().toString(36).slice(2, 7)}.${MARCA}@exemplo.br`,
      papel, instituicaoId, pessoaId])).rows[0];
  admin = await usuario('admin', null);
  diretoria = await usuario('diretoria', null);
  repr = await usuario('representante', instA, pessoaA);
});

after(async () => {
  if (!rodar) return;
  await db.end();
  await fecharPool();
});

describe('relatórios', { skip: !rodar }, () => {
  test('célula que parece fórmula vira texto', () => {
    assert.equal(celulaSegura('=1+1'), "'=1+1");
    assert.equal(celulaSegura('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(celulaSegura('Normal'), 'Normal');
    assert.equal(celulaSegura(3), 3);
  });

  test('xlsx real da própria instituição, com link assinado do dono', async () => {
    const r = await gerarRelatorio(repr, { tipo: 'minha-instituicao' }, { inicio: `${ANO}-05-01`, fim: `${ANO}-05-10`, formato: 'xlsx' }, BASE);
    assert.match(r.downloadUrl, /^https:\/\/api\.exemplo\.br\/api\/governanca\/arquivos\//);
    const t = verificar(r.downloadUrl.split('/').pop());
    assert.equal(t.t, 'rel');
    const arq = await baixarRelatorio(await usuarioPorId(t.u), t.id);
    assert.equal(arq.conteudo.subarray(0, 2).toString(), 'PK');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arq.conteudo);
    const resumo = wb.getWorksheet('Resumo');
    assert.ok(String(resumo.getCell('B3').value).startsWith("'="), 'nome com = vira texto');
    const valores = resumo.getColumn(2).values.map(String);
    assert.ok(valores.includes('100%'));
    assert.equal(wb.getWorksheet('Presenças').rowCount, 2);
    // Outra conta não baixa o relatório (o RLS confere de novo).
    await assert.rejects(() => baixarRelatorio(diretoria, t.id), codigo('NAO_ENCONTRADO'));
  });

  test('período inclusivo: fora do período não conta', async () => {
    const r = await gerarRelatorio(repr, { tipo: 'minha-instituicao' }, { inicio: `${ANO}-05-11`, fim: `${ANO}-12-31`, formato: 'xlsx' }, BASE);
    const t = verificar(r.downloadUrl.split('/').pop());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await baixarRelatorio(repr, t.id)).conteudo);
    assert.equal(wb.getWorksheet('Presenças').rowCount, 1);
  });

  test('pdf real da reunião; representante não gera relatório de atividade', async () => {
    const r = await gerarRelatorio(diretoria, { tipo: 'reunioes', id: reuniaoId }, { inicio: `${ANO}-05-10`, fim: `${ANO}-05-10`, formato: 'pdf' }, BASE);
    const t = verificar(r.downloadUrl.split('/').pop());
    const arq = await baixarRelatorio(diretoria, t.id);
    assert.equal(arq.conteudo.subarray(0, 4).toString(), '%PDF');
    await assert.rejects(() => gerarRelatorio(repr, { tipo: 'reunioes', id: reuniaoId }, { inicio: `${ANO}-01-01`, fim: `${ANO}-12-31`, formato: 'pdf' }, BASE),
      codigo('SEM_PERMISSAO'));
    await assert.rejects(() => gerarRelatorio(diretoria, { tipo: 'eventos', id: reuniaoId }, { inicio: `${ANO}-01-01`, fim: `${ANO}-12-31`, formato: 'pdf' }, BASE),
      codigo('NAO_ENCONTRADO'));
    await assert.rejects(() => gerarRelatorio(diretoria, { tipo: 'reunioes', id: reuniaoId }, { inicio: `${ANO}-06-01`, fim: `${ANO}-06-30`, formato: 'pdf' }, BASE),
      codigo('DADOS_INVALIDOS'));
  });
});

describe('importação', { skip: !rodar }, () => {
  const cab = 'nomeFantasia;razaoSocial;cnpj;email;telefone;vertente;gts;dataIngresso';

  test('CSV com aspas e ponto e vírgula', () => {
    assert.deepEqual(lerCsv('a;"b;c";"d ""e"""\r\n1;2;3\n'), [['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
  });

  test('só o admin importa', async () => {
    await assert.rejects(() => validarImportacao(diretoria, 'instituicoes', csv([cab])), codigo('SEM_PERMISSAO'));
  });

  test('erros e duplicidades aparecem por linha e impedem a confirmação', async () => {
    const c1 = cnpj(`11${String(Date.now()).slice(-10)}`);
    const r = await validarImportacao(admin, 'instituicoes', csv([
      cab,
      `Nova ${MARCA};Razão;${c1};contato@exemplo.br;;;;${ANO}-01-01`,
      `Repetida ${MARCA};;${c1};;;;;`,
      `X;;123;email-ruim;;Inexistente;;2026-13-40`,
    ]));
    assert.equal(r.previa.validos, 1);
    assert.equal(r.previa.duplicados, 1);
    assert.deepEqual(r.previa.erros.map((e) => e.linha), [3, 4]);
    assert.equal(r.previa.podeConfirmar, false);
    await assert.rejects(() => confirmarImportacao(admin, { previaId: r.previa.id }), codigo('TRANSICAO_INVALIDA'));
  });

  test('confirma numa transação, de forma idempotente; prévia de outro admin não serve', async () => {
    const c1 = cnpj(`22${String(Date.now()).slice(-10)}`);
    const r = await validarImportacao(admin, 'instituicoes', csv([cab, `Importada ${MARCA};Razão;${c1};;;;;${ANO}-01-01`]));
    assert.equal(r.previa.podeConfirmar, true);
    const outro = (await db.query(
      `insert into usuario (nome, email, papel) values ('Outro admin', $1, 'admin') returning id, nome, email, papel, ativo`,
      [`outro.${MARCA}@exemplo.br`])).rows[0];
    await assert.rejects(() => confirmarImportacao(outro, { previaId: r.previa.id }), codigo('TRANSICAO_INVALIDA'));
    const c = await confirmarImportacao(admin, { previaId: r.previa.id });
    assert.equal(c.importacao.importados, 1);
    const de_novo = await confirmarImportacao(admin, { previaId: r.previa.id });
    assert.equal(de_novo.importacao.id, c.importacao.id);
    const { rows } = await db.query('select count(*)::int as n, max(status::text) as s from instituicao where cnpj = $1', [c1]);
    assert.deepEqual(rows[0], { n: 1, s: 'ativa' });
    const l = await listarImportacoes(admin);
    assert.ok(l.dados.some((x) => x.id === c.importacao.id && x.autorNome === admin.nome));
  });

  test('presenças: vínculo na data, horário obrigatório e duplicidade contra o banco', async () => {
    const outra = (await db.query(
      `insert into reuniao (titulo, data, status, natureza) values ($1, '${ANO}-05-20', 'encerrada', 'reuniao') returning id`,
      [`Outra ${MARCA}`])).rows[0].id;
    const cabP = 'atividadeTipo;atividadeId;pessoaId;instituicaoId;statusPresenca;modalidade;horarioCheckin;justificativa';
    const r = await validarImportacao(admin, 'presencas', csv([
      cabP,
      `reuniao;${outra};${pessoaA};${instA};presente;presencial;${ANO}-05-20T09:10;Lista em papel`,
      `reuniao;${reuniaoId};${pessoaA};${instA};presente;presencial;${ANO}-05-10T09:00;Lista em papel`,
      `evento;${outra};00000000-0000-4000-8000-000000000000;;presente;;;x`,
    ]));
    assert.equal(r.previa.validos, 1);
    assert.equal(r.previa.duplicados, 1);
    assert.equal(r.previa.erros.length, 2);
    const ok = await validarImportacao(admin, 'presencas', csv([
      cabP, `reuniao;${outra};${pessoaA};${instA};presente;online;${ANO}-05-20T09:10;Lista em papel`]));
    const c = await confirmarImportacao(admin, { previaId: ok.previa.id });
    assert.equal(c.importacao.importados, 1);
    const { rows } = await db.query('select origem::text, modo from presenca where reuniao_id = $1', [outra]);
    assert.deepEqual(rows[0], { origem: 'importacao', modo: 'online' });
  });

  test('arquivo que não é UTF-8 é recusado', async () => {
    await assert.rejects(() => validarImportacao(admin, 'instituicoes',
      { nome: 'x.csv', conteudo: Buffer.from([0x6e, 0x6f, 0x6d, 0xe9, 0x0a]) }), codigo('TIPO_NAO_PERMITIDO'));
  });
});
