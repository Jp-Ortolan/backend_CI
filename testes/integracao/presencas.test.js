/**
 * Testes de integração — marcação manual de presença e histórico por instituição.
 *
 * Cobrem os dois cards que faltavam das Semanas 4 e 5.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fecharPool } from '@/infraestrutura/banco/pool.js';

import { marcarPresenca } from '@/aplicacao/presencas/marcar-presenca.js';
import { obterHistoricoInstituicao } from '@/aplicacao/historico/obter-historico-instituicao.js';
import { criarInstituicao } from '@/aplicacao/instituicoes/criar-instituicao.js';
import { criarRepresentante } from '@/aplicacao/representantes/criar-representante.js';
import { criarReuniao } from '@/aplicacao/reunioes/criar-reuniao.js';
import { encerrarReuniao } from '@/aplicacao/reunioes/encerrar-reuniao.js';
import { listarParticipantes } from '@/aplicacao/convites/listar-participantes.js';

const { Client } = pg;

const URL_APP = process.env.DATABASE_URL ?? '';
const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? '';
const rodar = URL_APP.length > 0 && URL_ADMIN.length > 0;

/** @type {import('pg').Client} */
let db;
const MARCA = `p${Date.now()}`;

/** @type {any} */ let gestor;
/** @type {any} */ let leitura;
/** @type {string} */ let instId;
/** @type {string} */ let pessoaId;
/** @type {string} */ let reuniaoHoje;

const hoje = () => new Date().toISOString().slice(0, 10);
/** @param {number} d */
const emDias = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

function gerarCnpj() {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  /** @param {string} p @param {number[]} w */
  const dig = (p, w) => {
    const s = p.split('').reduce((a, n, i) => a + Number(n) * w[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const d1 = dig(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dig(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

before(async () => {
  if (!rodar) return;
  db = new Client({
    connectionString: URL_ADMIN,
    ssl: /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(URL_ADMIN)
      ? undefined : { rejectUnauthorized: false },
  });
  await db.connect();

  /** @param {string} papel */
  const criarUsuario = async (papel) => (await db.query(
    `insert into usuario (nome, email, papel) values ($1,$2,$3)
     returning id, nome, email, papel, ativo`,
    [`Teste ${papel} ${MARCA}`, `${papel}.${MARCA}@exemplo.br`, papel],
  )).rows[0];

  gestor = await criarUsuario('gestor');
  leitura = await criarUsuario('leitura');

  const { rows: t } = await db.query('select id from tipo_instituicao order by id limit 1');
  const { rows: a } = await db.query('select id from area_atuacao order by id limit 1');

  const inst = await criarInstituicao(gestor, {
    nome: `Instituicao ${MARCA}`, cnpj: gerarCnpj(), dataFundacao: '2000-01-01',
    status: 'ativa', telefone: '(42) 3333-3333', logradouro: 'Rua A', bairro: 'Centro',
    cidade: 'Guarapuava', estado: 'PR', cep: '85000000',
    tipoInstituicaoId: t[0].id, areaAtuacaoId: a[0].id,
    email: `inst.${MARCA}@exemplo.br`,
  });
  instId = inst.id;

  const rep = await criarRepresentante(gestor, {
    nome: `Representante ${MARCA}`,
    email: `rep.${MARCA}@exemplo.br`,
    vinculo: { instituicaoId: instId, cargo: 'Coordenador', dataInicio: emDias(-30) },
  });
  pessoaId = rep.pessoaId;

  const r = await criarReuniao(gestor, { titulo: `Hoje ${MARCA}`, data: hoje() });
  reuniaoHoje = r.id;
});

after(async () => {
  if (!rodar) return;
  // Ordem importa: encerrar uma reunião cria presença de AUSENTE para todo
  // vínculo vigente na data, inclusive os do seed. Apagar por pessoa_id não
  // alcança essas linhas, e a trigger da 003 recusaria apagar a reunião.
  await db.query(
    'delete from presenca where reuniao_id in (select id from reuniao where titulo like $1)',
    [`%${MARCA}%`]);
  await db.query(
    `delete from reuniao_convite where reuniao_id in
       (select id from reuniao where titulo like $1)`, [`%${MARCA}%`]);
  await db.query('delete from presenca where pessoa_id = $1', [pessoaId]);
  await db.query('delete from presenca where instituicao_id = $1', [instId]);
  await db.query('delete from reuniao_convite where pessoa_id = $1', [pessoaId]);
  await db.query('delete from reuniao where titulo like $1', [`%${MARCA}%`]);
  await db.query('delete from vinculo where pessoa_id = $1', [pessoaId]);
  await db.query('delete from pessoa where id = $1', [pessoaId]);
  await db.query('delete from vinculo where instituicao_id = $1', [instId]);
  await db.query('delete from instituicao where id = $1', [instId]);
  await db.query('delete from usuario where email like $1', [`%.${MARCA}@exemplo.br`]);
  await db.end();
  // Sem isto o processo fica 30 segundos de pé esperando o pool ocioso.
  await fecharPool();
});

describe('marcação manual de presença', { skip: !rodar }, () => {
  test('marca presente e grava a origem e o autor', async () => {
    const r = await marcarPresenca(gestor, reuniaoHoje, {
      pessoaId, status: 'presente', observacoes: 'Celular sem bateria',
    });

    assert.equal(r.status, 'presente');
    assert.equal(r.origem, 'manual');
    assert.ok(r.horarioCheckin, 'presente sem horário quebraria a constraint do banco');

    const { rows } = await db.query(
      'select registrado_por, instituicao_id, cargo_no_momento from presenca where id = $1',
      [r.id],
    );
    assert.equal(rows[0].registrado_por, gestor.id, 'precisa saber quem lançou');
    assert.equal(rows[0].instituicao_id, instId,
      'o snapshot do vínculo tem que ser igual ao do check-in por QR');
    assert.equal(rows[0].cargo_no_momento, 'Coordenador');
  });

  test('corrigir a marcação não duplica a linha', async () => {
    await marcarPresenca(gestor, reuniaoHoje, { pessoaId, status: 'ausente' });

    const { rows } = await db.query(
      'select count(*)::int as n from presenca where reuniao_id = $1 and pessoa_id = $2',
      [reuniaoHoje, pessoaId],
    );
    assert.equal(rows[0].n, 1, 'corrigir tem que atualizar, não criar uma segunda linha');
  });

  test('ausente e justificado ficam sem horário de entrada', async () => {
    const r = await marcarPresenca(gestor, reuniaoHoje, { pessoaId, status: 'justificado' });
    assert.equal(r.horarioCheckin, null,
      'a pessoa não chegou — gravar "agora" seria inventar um dado');
  });

  test('aparece na lista de presença da reunião', async () => {
    await marcarPresenca(gestor, reuniaoHoje, { pessoaId, status: 'presente' });
    const lista = await listarParticipantes(gestor, reuniaoHoje, {});
    const p = lista.dados.find((/** @type {any} */ x) => x.pessoaId === pessoaId);
    assert.equal(p?.statusPresenca, 'presente');
    assert.equal(p?.origemPresenca, 'manual');
  });

  test('recusa quem não tinha vínculo na data da reunião', async () => {
    const antiga = await criarReuniao(gestor, {
      titulo: `Antiga ${MARCA}`, data: emDias(-200),
    });
    await assert.rejects(
      () => marcarPresenca(gestor, antiga.id, { pessoaId, status: 'presente' }),
      (/** @type {any} */ e) => e.codigo === 'VINCULO_INVALIDO',
    );
  });

  test('perfil de consulta não marca presença', async () => {
    await assert.rejects(
      () => marcarPresenca(leitura, reuniaoHoje, { pessoaId, status: 'presente' }),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );
  });

  test('status inválido é recusado', async () => {
    await assert.rejects(
      () => marcarPresenca(gestor, reuniaoHoje, { pessoaId, status: 'talvez' }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });
});

describe('histórico por instituição', { skip: !rodar }, () => {
  before(async () => {
    if (!rodar) return;
    // Deixa a reunião de hoje encerrada, com a presença marcada.
    await marcarPresenca(gestor, reuniaoHoje, { pessoaId, status: 'presente' });
    await encerrarReuniao(gestor, reuniaoHoje);
  });

  test('lista a reunião com quem compareceu', async () => {
    const h = await obterHistoricoInstituicao(gestor, instId, {});

    assert.equal(h.instituicao.id, instId);
    const linha = h.historico.find((/** @type {any} */ l) => l.reuniaoId === reuniaoHoje);
    assert.ok(linha, 'a reunião encerrada deveria estar no histórico');
    assert.equal(linha.compareceu, true);
    assert.equal(linha.presentes, 1);
    assert.ok(linha.participantes.length >= 1, 'precisa dizer QUEM foi');
    assert.equal(linha.participantes[0].cargo, 'Coordenador');
  });

  test('reunião anterior à entrada da instituição não conta como falta', async () => {
    // O vínculo começou há 30 dias; esta reunião é de 200 dias atrás.
    const antiga = await criarReuniao(gestor, {
      titulo: `MuitoAntiga ${MARCA}`, data: emDias(-200),
    });
    await encerrarReuniao(gestor, antiga.id);

    const h = await obterHistoricoInstituicao(gestor, instId, {});
    const achou = h.historico.some((/** @type {any} */ l) => l.reuniaoId === antiga.id);

    assert.equal(achou, false,
      'reunião de antes da entrada não é ausência — é reunião que não lhe dizia respeito');
  });

  test('filtra por período', async () => {
    const h = await obterHistoricoInstituicao(gestor, instId, {
      de: emDias(-1), ate: emDias(1),
    });
    assert.ok(h.historico.every((/** @type {any} */ l) => l.data >= emDias(-1)),
      'nada fora do período pedido');
  });

  test('instituição inexistente devolve 404', async () => {
    await assert.rejects(
      () => obterHistoricoInstituicao(gestor, '00000000-0000-0000-0000-000000000000', {}),
      (/** @type {any} */ e) => e.codigo === 'NAO_ENCONTRADO',
    );
  });

  test('perfil de consulta lê o histórico', async () => {
    const h = await obterHistoricoInstituicao(leitura, instId, {});
    assert.ok(h.resumo, 'consulta é leitura, e leitura pode ler');
  });
});
