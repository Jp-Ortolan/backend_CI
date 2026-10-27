/**
 * Contrato /api/governanca — reuniões, eventos, credenciamento, check-in,
 * convocações (RSVP) e encaminhamentos. PostgreSQL de verdade, RLS valendo.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fecharPool } from '@/infraestrutura/banco/pool.js';

import {
  listarEventos, configuracaoEventos, obterEvento, salvarEvento,
  obterGovernancaReuniao, salvarGovernancaReuniao,
} from '@/aplicacao/governanca/atividades.js';
import {
  obterCredenciamento, abrirCredenciamento, encerrarCredenciamento, registrarPresencaManual, imagemQr,
} from '@/aplicacao/governanca/credenciamento.js';
import {
  obterOrganizacao, convocar, salvarEncaminhamento, convocacoesDaInstituicao, responderConvocacao,
} from '@/aplicacao/governanca/organizacao.js';
import { abrirCheckin, confirmarCheckin } from '@/aplicacao/governanca/checkin.js';
import { listarNotificacoes } from '@/aplicacao/governanca/notificacoes.js';

const { Client } = pg;
const rodar = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN;

/** @type {import('pg').Client} */ let db;
const MARCA = `a${Date.now()}`;
const BASE = 'https://api.exemplo.br';
const HOJE = new Date().toISOString().slice(0, 10);
const NUMERO = 100000 + Math.floor(Math.random() * 800000);

/** @type {any} */ let admin;
/** @type {any} */ let diretoria;
/** @type {any} */ let repr;
/** @type {any} */ let reprOutra;
/** @type {string} */ let instA;
/** @type {string} */ let instB;
/** @type {string} */ let pessoaA;
/** @type {string} */ let pessoaB;
/** @type {string} */ let reuniaoId;
/** @type {string} */ let eventoId;

const codigo = (c) => (/** @type {any} */ e) => {
  if (e.codigo !== c) console.error(e);
  return e.codigo === c;
};
/** "AAAA-MM-DDTHH:mm" local (São Paulo) daqui a `min` minutos. */
const local = (min) => new Date(Date.now() - 3 * 3600_000 + min * 60_000).toISOString().slice(0, 16);

before(async () => {
  if (!rodar) return;
  db = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
  await db.connect();
  const { rows: t } = await db.query('select id from tipo_instituicao order by id limit 1');
  const { rows: a } = await db.query('select id from area_atuacao order by id limit 1');
  const inst = async (nome, email) => (await db.query(
    `insert into instituicao (nome, status, data_entrada, tipo_instituicao_id, area_atuacao_id, autoriza_divulgacao, email)
     values ($1, 'ativa', '2020-01-01', $2, $3, true, $4) returning id`, [nome, t[0].id, a[0].id, email])).rows[0].id;
  instA = await inst(`Ativ A ${MARCA}`, `a.${MARCA}@exemplo.br`);
  instB = await inst(`Ativ B ${MARCA}`, null);
  const pessoa = async (nome, instituicaoId) => {
    const id = (await db.query(`insert into pessoa (nome, email) values ($1, $2) returning id`,
      [nome, `${nome.replace(/\W/g, '').toLowerCase()}@exemplo.br`])).rows[0].id;
    await db.query(`insert into vinculo (pessoa_id, instituicao_id, tipo_representacao, data_inicio)
                    values ($1, $2, 'titular', '2020-01-01')`, [id, instituicaoId]);
    return id;
  };
  pessoaA = await pessoa(`Pessoa A ${MARCA}`, instA);
  pessoaB = await pessoa(`Pessoa B ${MARCA}`, instB);
  const usuario = async (papel, instituicaoId, pessoaId = null) => (await db.query(
    `insert into usuario (nome, email, papel, instituicao_id, pessoa_id)
     values ($1, $2, $3, $4, $5)
     returning id, nome, email, papel, ativo, instituicao_id as "instituicaoId", pessoa_id as "pessoaId"`,
    [`Ativ ${papel} ${MARCA}`, `${papel}.${Math.random().toString(36).slice(2, 7)}.${MARCA}@exemplo.br`,
      papel, instituicaoId, pessoaId])).rows[0];
  admin = await usuario('admin', null);
  diretoria = await usuario('diretoria', null);
  repr = await usuario('representante', instA, pessoaA);
  reprOutra = await usuario('representante', instB, pessoaB);
  reuniaoId = (await db.query(
    `insert into reuniao (titulo, data, status, natureza, conta_participacao, hora_inicio)
     values ($1, current_date, 'agendada', 'reuniao', true, '09:00') returning id`, [`Reunião Ativ ${MARCA}`])).rows[0].id;
});

after(async () => {
  if (!rodar) return;
  await db.end();
  await fecharPool();
});

describe('eventos', { skip: !rodar }, () => {
  test('configuração só para quem cria', async () => {
    assert.ok(configuracaoEventos(diretoria).categorias.includes('workshop'));
    assert.throws(() => configuracaoEventos(repr), codigo('SEM_PERMISSAO'));
  });

  test('criar evento: validação, categoria e envelope evento', async () => {
    await assert.rejects(() => salvarEvento(diretoria, null, { titulo: 'Sem data', categoria: 'workshop' }),
      codigo('DADOS_INVALIDOS'));
    await assert.rejects(() => salvarEvento(diretoria, null, {
      titulo: 'Horário invertido', categoria: 'workshop', data: HOJE, horaInicio: '10:00', horaFim: '09:00',
      organizacao: 'Centro', modalidade: 'presencial',
    }), codigo('DADOS_INVALIDOS'));
    const r = await salvarEvento(diretoria, null, {
      titulo: `Workshop ${MARCA}`, categoria: 'workshop', data: HOJE, horaInicio: '14:00', horaFim: '17:00',
      modalidade: 'hibrida', organizacao: 'Centro de Inovação', origem: 'proprio', status: 'publicada',
      inscricaoExterna: 'https://inscricao.exemplo.br', exibirCalendario: true, limiteParticipantes: '2',
    });
    eventoId = r.evento.id;
    assert.equal(r.evento.categoria, 'workshop');
    assert.equal(r.evento.status, 'publicada');
    assert.equal(r.evento.contaParticipacao, false);
    assert.equal(r.evento.limiteParticipantes, 2);
    assert.equal(r.evento.horaInicio, '14:00');
  });

  test('evento não responde como reunião, nem reunião como evento', async () => {
    await assert.rejects(() => obterGovernancaReuniao(diretoria, eventoId), codigo('NAO_ENCONTRADO'));
    await assert.rejects(() => obterEvento(diretoria, reuniaoId), codigo('NAO_ENCONTRADO'));
  });

  test('editar com versão e transição validada; lista traz o evento', async () => {
    const { evento } = await obterEvento(diretoria, eventoId);
    const e = await salvarEvento(diretoria, eventoId, { pauta: 'Abertura', versaoRegistro: evento.versaoRegistro });
    assert.equal(e.evento.pauta, 'Abertura');
    await assert.rejects(() => salvarEvento(diretoria, eventoId, { pauta: 'x', versaoRegistro: evento.versaoRegistro }),
      codigo('VERSAO_DESATUALIZADA'));
    await assert.rejects(() => salvarEvento(diretoria, eventoId, { status: 'rascunho' }).then(() =>
      salvarEvento(diretoria, eventoId, { status: 'em_andamento' })), codigo('TRANSICAO_INVALIDA'));
    await salvarEvento(diretoria, eventoId, { status: 'publicada' });
    const l = await listarEventos(repr);
    assert.ok(l.dados.some((x) => x.id === eventoId));
  });
});

describe('ficha de governança da reunião', { skip: !rodar }, () => {
  test('tipo, ata, convocadas e versão', async () => {
    const r = await obterGovernancaReuniao(diretoria, reuniaoId);
    const s = await salvarGovernancaReuniao(diretoria, reuniaoId, {
      tipo: 'ordinaria', numero: NUMERO, ata: 'Ata da reunião', instituicoesConvocadas: `${instA}, ${instB}`,
      versaoRegistro: r.versaoRegistro,
    });
    assert.equal(s.tipo, 'ordinaria');
    assert.equal(s.numero, NUMERO);
    assert.equal(s.ata, 'Ata da reunião');
    assert.equal(s.instituicoesConvocadas.split(', ').length, 2);
    await assert.rejects(() => salvarGovernancaReuniao(diretoria, reuniaoId, { instituicoesConvocadas: 'abc' }),
      codigo('DADOS_INVALIDOS'));
    await assert.rejects(() => salvarGovernancaReuniao(repr, reuniaoId, { ata: 'x' }), codigo('SEM_PERMISSAO'));
  });
});

describe('credenciamento e check-in', { skip: !rodar }, () => {
  /** @type {string} */ let token;

  test('abrir: horário local, QR novo, só a gestão', async () => {
    await assert.rejects(() => abrirCredenciamento(repr, eventoId, 'evento', { inicio: local(-5), fim: local(60) }),
      codigo('SEM_PERMISSAO'));
    await assert.rejects(() => abrirCredenciamento(diretoria, eventoId, 'evento', { inicio: local(60), fim: local(-5) }),
      codigo('DADOS_INVALIDOS'));
    const antes = await obterCredenciamento(diretoria, eventoId, 'evento', BASE);
    await abrirCredenciamento(diretoria, eventoId, 'evento', { inicio: local(-5), fim: local(60), permiteConvidados: true });
    const c = await obterCredenciamento(diretoria, eventoId, 'evento', BASE);
    assert.equal(c.status, 'aberto');
    assert.match(c.inicio, /-03:00$/);
    assert.notEqual(c.checkinUrl, antes.checkinUrl, 'abrir troca o token do QR');
    assert.match(c.qrCodeUrl, /^https:\/\/api\.exemplo\.br\/api\/governanca\/qr\/[0-9a-f]{32}$/);
    assert.equal(c.registroOfflineHabilitado, true);
    assert.ok(c.pessoas.some((p) => p.id === pessoaA));
    token = c.checkinUrl.split('/').pop();
    const png = await imagemQr(token);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    await assert.rejects(() => imagemQr(antes.checkinUrl.split('/').pop()).then(() => imagemQr('0'.repeat(32))),
      codigo('NAO_ENCONTRADO'));
  });

  test('visitante: convidado com assinatura; não se declara representante; duplicado é 409', async () => {
    const g = await abrirCheckin(token, null);
    assert.equal(g.aberto, true);
    assert.equal(g.participante, null);
    assert.ok(g.instituicoes.every((i) => i.id && i.nome));
    await assert.rejects(() => confirmarCheckin(token, { nome: 'Convidada Teste', email: 'c@exemplo.br', modalidade: 'presencial' },
      { usuario: null, ip: '1.1.1.1' }), codigo('DADOS_INVALIDOS'));
    const r = await confirmarCheckin(token, {
      nome: 'Convidada Teste', email: `conv.${MARCA}@exemplo.br`, tipo: 'representante', modalidade: 'presencial',
      assinatura: 'Convidada Teste',
    }, { usuario: null, ip: '1.1.1.1' });
    assert.equal(r.presenca.tipo, 'convidado');
    assert.match(r.presenca.horarioCheckin, /-03:00$/);
    await assert.rejects(() => confirmarCheckin(token, {
      nome: 'Outra Pessoa', email: `CONV.${MARCA}@exemplo.br`, assinatura: 'Outra Pessoa',
    }, { usuario: null, ip: '1.1.1.1' }), codigo('PRESENCA_JA_REGISTRADA'));
    const { rows } = await db.query('select assinatura_nome from presenca where id = $1', [r.presenca.id]);
    assert.equal(rows[0].assinatura_nome, 'Convidada Teste');
  });

  test('logado: dados da sessão, instituição do vínculo; segunda vez é 409', async () => {
    const g = await abrirCheckin(token, repr);
    assert.equal(g.participante.tipo, 'representante');
    assert.equal(g.participante.instituicaoId, instA);
    assert.deepEqual(g.instituicoes.map((i) => i.id), [instA]);
    const r = await confirmarCheckin(token, { assinatura: 'Pessoa A', modalidade: 'online', nome: 'Outro nome' },
      { usuario: repr, ip: null });
    assert.equal(r.presenca.tipo, 'representante');
    await assert.rejects(() => confirmarCheckin(token, { assinatura: 'Pessoa A' }, { usuario: repr, ip: null }),
      codigo('PRESENCA_JA_REGISTRADA'));
  });

  test('limite de participantes vale no check-in', async () => {
    await assert.rejects(() => confirmarCheckin(token, {
      nome: 'Terceira Pessoa', email: `t.${MARCA}@exemplo.br`, assinatura: 'Terceira Pessoa',
    }, { usuario: null, ip: '1.1.1.1' }), codigo('LIMITE_ATINGIDO'));
  });

  test('representante vê só a lista da própria instituição', async () => {
    const c = await obterCredenciamento(reprOutra, eventoId, 'evento', BASE);
    assert.equal(c.participantes.length, 0);
    assert.equal(c.qrCodeUrl, null);
    assert.deepEqual(c.pessoas, []);
  });

  test('presença manual: justificativa obrigatória, idempotente pela chave, conteúdo diferente é 409', async () => {
    await abrirCredenciamento(diretoria, reuniaoId, 'reuniao', { inicio: local(-5), fim: local(60) });
    const corpo = {
      pessoaId: pessoaB, instituicaoId: instB, tipo: 'representante', statusPresenca: 'justificada',
      modalidade: 'presencial', justificativa: 'Avisou por e-mail',
    };
    await assert.rejects(() => registrarPresencaManual(diretoria, reuniaoId, 'reuniao', { ...corpo, justificativa: '' }),
      codigo('DADOS_INVALIDOS'));
    await assert.rejects(() => registrarPresencaManual(diretoria, reuniaoId, 'reuniao', { ...corpo, instituicaoId: instA }),
      codigo('VINCULO_INVALIDO'));
    const chave = crypto.randomUUID();
    const r1 = await registrarPresencaManual(diretoria, reuniaoId, 'reuniao',
      { ...corpo, chaveOperacao: chave, registradoOfflineEm: new Date().toISOString() });
    const r2 = await registrarPresencaManual(diretoria, reuniaoId, 'reuniao',
      { ...corpo, chaveOperacao: chave, registradoOfflineEm: new Date().toISOString() });
    assert.equal(r2.presenca.id, r1.presenca.id);
    assert.equal(r2.repetida, true);
    await assert.rejects(() => registrarPresencaManual(diretoria, reuniaoId, 'reuniao',
      { ...corpo, statusPresenca: 'presente', chaveOperacao: chave }), codigo('OPERACAO_REPETIDA_DIFERENTE'));
    const { rows } = await db.query(
      `select count(*)::int as n, max(status::text) as s from presenca where reuniao_id = $1 and pessoa_id = $2`,
      [reuniaoId, pessoaB]);
    assert.deepEqual(rows[0], { n: 1, s: 'justificado' });
    await assert.rejects(() => registrarPresencaManual(repr, reuniaoId, 'reuniao', corpo), codigo('ALTERACAO_EXIGE_APROVACAO'));
  });

  test('equipe entra na lista sem contar para instituição', async () => {
    await registrarPresencaManual(diretoria, reuniaoId, 'reuniao', {
      pessoaId: pessoaA, tipo: 'equipe', statusPresenca: 'presente', modalidade: 'presencial', justificativa: 'Equipe do Centro',
    });
    const { rows } = await db.query(
      `select tipo, instituicao_id, vinculo_id from presenca where reuniao_id = $1 and pessoa_id = $2`, [reuniaoId, pessoaA]);
    assert.deepEqual(rows[0], { tipo: 'equipe', instituicao_id: null, vinculo_id: null });
  });

  test('encerrar credenciamento fecha o check-in', async () => {
    await encerrarCredenciamento(diretoria, eventoId, 'evento');
    const c = await obterCredenciamento(diretoria, eventoId, 'evento', BASE);
    assert.equal(c.status, 'encerrado');
    const g = await abrirCheckin(token, null);
    assert.equal(g.aberto, false);
  });
});

describe('convocações e encaminhamentos', { skip: !rodar }, () => {
  test('convocar: idempotente, entrega registrada, RSVP pela instituição', async () => {
    const chave = crypto.randomUUID();
    const corpo = { assunto: `Convocação ${MARCA}`, mensagem: 'Participem', prazoResposta: local(24 * 60),
      instituicoes: [instA, instB], chaveOperacao: chave };
    await assert.rejects(() => convocar(repr, reuniaoId, 'reuniao', corpo), codigo('SEM_PERMISSAO'));
    const r1 = await convocar(diretoria, reuniaoId, 'reuniao', corpo);
    assert.equal(r1.convocacoes.length, 2);
    const r2 = await convocar(diretoria, reuniaoId, 'reuniao', corpo);
    assert.deepEqual(r2.convocacoes, r1.convocacoes);
    await assert.rejects(() => convocar(diretoria, reuniaoId, 'reuniao', { ...corpo, mensagem: 'Outra' }),
      codigo('OPERACAO_REPETIDA_DIFERENTE'));

    const org = await obterOrganizacao(diretoria, reuniaoId, 'reuniao');
    const ca = org.convocacoes.find((c) => c.instituicaoId === instA);
    const cb = org.convocacoes.find((c) => c.instituicaoId === instB);
    // Sem provedor de e-mail configurado no teste: falhou, nunca "entregue".
    assert.equal(ca.statusEntrega, 'falhou');
    assert.match(ca.detalheEntrega, /provedor/i);
    assert.equal(cb.statusEntrega, 'falhou');

    const orgRepr = await obterOrganizacao(repr, reuniaoId, 'reuniao');
    assert.deepEqual(orgRepr.convocacoes.map((c) => c.instituicaoId), [instA]);

    const minhas = await convocacoesDaInstituicao(repr);
    const minha = minhas.dados.find((c) => c.id === ca.id);
    assert.equal(minha.podeResponder, true);
    assert.ok(minhas.representantes.some((p) => p.id === pessoaA));
    await assert.rejects(() => responderConvocacao(repr, minha.id, { resposta: 'recusada' }), codigo('DADOS_INVALIDOS'));
    await assert.rejects(() => responderConvocacao(repr, minha.id, { resposta: 'confirmada', representanteId: pessoaB }),
      codigo('VINCULO_INVALIDO'));
    await assert.rejects(() => responderConvocacao(reprOutra, minha.id, { resposta: 'confirmada', representanteId: pessoaB }),
      codigo('NAO_ENCONTRADO'));
    await responderConvocacao(repr, minha.id, { resposta: 'confirmada', representanteId: pessoaA, versaoRegistro: minha.versaoRegistro });
    const depois = (await obterOrganizacao(diretoria, reuniaoId, 'reuniao')).convocacoes.find((c) => c.id === ca.id);
    assert.equal(depois.resposta, 'confirmada');
    assert.equal(depois.representanteNome, `Pessoa A ${MARCA}`);
    const n = await listarNotificacoes(repr);
    assert.ok(n.dados.some((x) => x.titulo.startsWith('Convocação')));
  });

  test('encaminhamento: responsável e prazo obrigatórios; conclusão exige resultado; fechado não reabre', async () => {
    await assert.rejects(() => salvarEncaminhamento(diretoria, reuniaoId, 'reuniao', null, { titulo: 'Sem responsável', prazo: HOJE }),
      codigo('DADOS_INVALIDOS'));
    const r = await salvarEncaminhamento(diretoria, reuniaoId, 'reuniao', null, {
      titulo: 'Publicar relatório', descricao: 'Versão final', responsavelId: pessoaA, prazo: HOJE, status: 'pendente',
    });
    assert.equal(r.encaminhamento.responsavelNome, `Pessoa A ${MARCA}`);
    await assert.rejects(() => salvarEncaminhamento(diretoria, reuniaoId, 'reuniao', r.encaminhamento.id, {
      ...r.encaminhamento, status: 'concluido', resultado: '',
    }), codigo('DADOS_INVALIDOS'));
    const c = await salvarEncaminhamento(diretoria, reuniaoId, 'reuniao', r.encaminhamento.id, {
      ...r.encaminhamento, status: 'concluido', resultado: 'Publicado no site',
    });
    assert.equal(c.encaminhamento.status, 'concluido');
    await assert.rejects(() => salvarEncaminhamento(diretoria, reuniaoId, 'reuniao', r.encaminhamento.id, {
      ...c.encaminhamento, status: 'pendente',
    }), codigo('TRANSICAO_INVALIDA'));
    await assert.rejects(() => salvarEncaminhamento(diretoria, reuniaoId, 'reuniao', r.encaminhamento.id, {
      ...c.encaminhamento, versaoRegistro: r.encaminhamento.versaoRegistro,
    }), codigo('VERSAO_DESATUALIZADA'));
    const n = await listarNotificacoes(repr);
    assert.ok(n.dados.some((x) => x.titulo.includes('Publicar relatório')));
  });

  test('encerrar a reunião pela ficha lança as ausências', async () => {
    const r = await obterGovernancaReuniao(diretoria, reuniaoId);
    const s = await salvarGovernancaReuniao(diretoria, reuniaoId, { status: 'encerrada', versaoRegistro: r.versaoRegistro });
    assert.equal(s.status, 'encerrada');
    await assert.rejects(() => salvarGovernancaReuniao(diretoria, reuniaoId, { status: 'publicada' }), codigo('TRANSICAO_INVALIDA'));
    const { rows } = await db.query(`select count(*)::int as n from presenca where reuniao_id = $1 and status = 'ausente'`, [reuniaoId]);
    assert.ok(rows[0].n > 0);
  });
});
