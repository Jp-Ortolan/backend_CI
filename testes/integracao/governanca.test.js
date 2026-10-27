/**
 * Contrato /api/governanca do front — cadastros, área da instituição,
 * solicitações, documentos, contas, notificações e auditoria.
 *
 * Mesmo esquema dos outros testes de integração: PostgreSQL de verdade, a
 * aplicação conectada como app_web (RLS valendo). Sem DATABASE_URL e
 * DATABASE_URL_ADMIN, o arquivo é pulado.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { NextRequest } from 'next/server';
import { fecharPool } from '@/infraestrutura/banco/pool.js';
import { verificar } from '@/infraestrutura/seguranca/assinatura.js';
import { despachar } from '@/infraestrutura/http/rotas-governanca.js';
import '@/aplicacao/governanca/rotas.js';

import { painelGovernanca } from '@/aplicacao/governanca/publico.js';
import {
  obterGovernancaInstituicao, salvarGovernancaInstituicao,
  obterGovernancaRepresentante, salvarGovernancaRepresentante,
} from '@/aplicacao/governanca/cadastros.js';
import {
  minhaInstituicao, solicitarPelaInstituicao, presencasDaInstituicao, representantesDaInstituicao,
} from '@/aplicacao/governanca/minha-instituicao.js';
import { filaDeSolicitacoes, decidirPeloContrato } from '@/aplicacao/governanca/solicitacoes.js';
import { listarDocumentosDoEscopo, enviarDocumentoDoEscopo } from '@/aplicacao/governanca/documentos.js';
import { listarContas, criarConta, editarConta } from '@/aplicacao/governanca/contas.js';
import { listarNotificacoes, marcarLida, salvarPreferencias } from '@/aplicacao/governanca/notificacoes.js';
import { consultarAuditoria, listarObservacoes, adicionarObservacao } from '@/aplicacao/governanca/auditoria.js';
import { usuarioPorId } from '@/aplicacao/governanca/comum.js';
import { baixarDocumento } from '@/aplicacao/documentos/baixar-documento.js';

const { Client } = pg;
const URL_APP = process.env.DATABASE_URL ?? '';
const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? '';
const rodar = URL_APP.length > 0 && URL_ADMIN.length > 0;

/** @type {import('pg').Client} */ let db;
const MARCA = `g${Date.now()}`;
const BASE = 'https://api.exemplo.br';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 32)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);

/** @type {any} */ let admin;
/** @type {any} */ let diretoria;
/** @type {any} */ let repr;
/** @type {any} */ let reprOutra;
/** @type {string} */ let instA;
/** @type {string} */ let instB;
/** @type {string} */ let titularId;
/** @type {string} */ let vinculoTitular;
/** @type {string} */ let reuniaoId;

const codigo = (c) => (/** @type {any} */ e) => {
  if (e.codigo !== c) console.error(e);
  return e.codigo === c;
};

before(async () => {
  if (!rodar) return;
  db = new Client({ connectionString: URL_ADMIN });
  await db.connect();
  const { rows: t } = await db.query('select id from tipo_instituicao order by id limit 1');
  const { rows: a } = await db.query('select id from area_atuacao order by id limit 1');
  const inst = async (nome) => (await db.query(
    `insert into instituicao (nome, status, data_entrada, tipo_instituicao_id, area_atuacao_id, autoriza_divulgacao)
     values ($1, 'ativa', '2020-01-01', $2, $3, true) returning id`, [nome, t[0].id, a[0].id])).rows[0].id;
  instA = await inst(`Gov A ${MARCA}`);
  instB = await inst(`Gov B ${MARCA}`);
  titularId = (await db.query(`insert into pessoa (nome, email) values ($1, $2) returning id`,
    [`Titular Gov ${MARCA}`, `tit.${MARCA}@exemplo.br`])).rows[0].id;
  vinculoTitular = (await db.query(
    `insert into vinculo (pessoa_id, instituicao_id, tipo_representacao, data_inicio, cargo)
     values ($1, $2, 'titular', '2020-01-01', 'Diretor') returning id`, [titularId, instA])).rows[0].id;
  // Uma reunião encerrada que conta: o titular faltou (ausência esperada).
  reuniaoId = (await db.query(
    `insert into reuniao (titulo, data, status, natureza, conta_participacao)
     values ($1, current_date - 3, 'encerrada', 'reuniao', true) returning id`, [`Reunião Gov ${MARCA}`])).rows[0].id;

  const usuario = async (papel, instituicaoId, pessoaId = null) => (await db.query(
    `insert into usuario (nome, email, papel, instituicao_id, pessoa_id)
     values ($1, $2, $3, $4, $5)
     returning id, nome, email, papel, ativo, instituicao_id as "instituicaoId", pessoa_id as "pessoaId"`,
    [`Gov ${papel} ${MARCA}`, `${papel}.${Math.random().toString(36).slice(2, 7)}.${MARCA}@exemplo.br`,
      papel, instituicaoId, pessoaId])).rows[0];
  admin = await usuario('admin', null);
  diretoria = await usuario('diretoria', null);
  repr = await usuario('representante', instA, titularId);
  reprOutra = await usuario('representante', instB);
});

after(async () => {
  if (!rodar) return;
  await db.end();
  await fecharPool();
});

describe('roteador /api/governanca', { skip: !rodar }, () => {
  const pedir = (metodo, caminho) => despachar(
    new NextRequest(`${BASE}/api/governanca/${caminho}`, { method: metodo }), caminho.split('/'));

  test('GET /publico responde sem login, com versao 1', async () => {
    const r = await pedir('GET', 'publico');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.versao, 1);
    assert.ok(Array.isArray(j.instituicoes));
    assert.ok(j.instituicoes.some((i) => i.id === instA));
    for (const i of j.instituicoes) assert.equal(i.autorizaDivulgacao, true);
  });

  test('caminho desconhecido é 404 no envelope de erro', async () => {
    const r = await pedir('GET', 'nada/aqui');
    assert.equal(r.status, 404);
    assert.equal((await r.json()).erro.codigo, 'NAO_ENCONTRADO');
  });

  test('id que não é UUID é 404, não 500', async () => {
    const r = await pedir('GET', 'instituicoes/abc/governanca');
    assert.equal(r.status, 404);
  });

  test('link de arquivo inválido é 401', async () => {
    const r = await pedir('GET', 'arquivos/xyz.abc');
    assert.equal(r.status, 401);
  });
});

describe('painel público', { skip: !rodar }, () => {
  test('indicadores e listas no formato do contrato, sem dado pessoal', async () => {
    const p = await painelGovernanca(BASE);
    assert.ok('participacao' in p.indicadores);
    const texto = JSON.stringify(p);
    assert.ok(!texto.includes(`tit.${MARCA}@exemplo.br`));
    for (const d of p.documentos) assert.match(d.url, /^https?:\/\//);
  });
});

describe('fichas de governança', { skip: !rodar }, () => {
  test('instituição: GET devolve a ficha com versaoRegistro', async () => {
    const r = await obterGovernancaInstituicao(diretoria, instA);
    assert.equal(r.titular, `Titular Gov ${MARCA}`);
    assert.equal(r.situacaoAdesao, 'aprovada');
    assert.ok(r.versaoRegistro >= 1);
  });

  test('instituição: só o admin edita direto; Diretoria recebe ALTERACAO_EXIGE_APROVACAO', async () => {
    await assert.rejects(() => salvarGovernancaInstituicao(diretoria, instA, { telefone: '1' }),
      codigo('ALTERACAO_EXIGE_APROVACAO'));
  });

  test('instituição: admin grava e a versão sobe; versão antiga é recusada', async () => {
    const antes = await obterGovernancaInstituicao(admin, instA);
    const depois = await salvarGovernancaInstituicao(admin, instA, {
      telefone: '(42) 3333-0000', gts: '', versaoRegistro: antes.versaoRegistro,
    });
    assert.equal(depois.telefone, '(42) 3333-0000');
    assert.ok(depois.versaoRegistro > antes.versaoRegistro);
    await assert.rejects(
      () => salvarGovernancaInstituicao(admin, instA, { telefone: '2', versaoRegistro: antes.versaoRegistro }),
      codigo('VERSAO_DESATUALIZADA'));
  });

  test('representante: ficha do vínculo vigente; intervalo invertido é recusado', async () => {
    const r = await obterGovernancaRepresentante(diretoria, titularId);
    assert.equal(r.tipo, 'titular');
    assert.equal(r.vinculoId, vinculoTitular);
    await assert.rejects(
      () => salvarGovernancaRepresentante(diretoria, titularId, { inicio: '2030-01-01', fim: '2029-01-01', motivoSubstituicao: 'x' }),
      codigo('DADOS_INVALIDOS'));
    const s = await salvarGovernancaRepresentante(diretoria, titularId, { cargoForum: 'Conselheiro', autorizaComunicacoes: true });
    assert.equal(s.cargoForum, 'Conselheiro');
    assert.equal(s.autorizaComunicacoes, true);
  });

  test('representante: Diretoria não liga conta (só o admin)', async () => {
    await assert.rejects(
      () => salvarGovernancaRepresentante(diretoria, titularId, { usuarioId: admin.id }),
      codigo('DADOS_INVALIDOS'));
  });
});

describe('área da instituição e aprovação', { skip: !rodar }, () => {
  test('a instituição vem da sessão; representante sem instituição recebe erro claro', async () => {
    const r = await minhaInstituicao(repr);
    assert.equal(r.instituicao.id, instA);
    assert.ok(r.participacao.descricao.length > 0);
    assert.ok(r.participacao.atividades.some((a) => a.id === reuniaoId && a.status === 'ausente'));
    await assert.rejects(() => minhaInstituicao({ ...repr, instituicaoId: null }), codigo('CONTA_SEM_INSTITUICAO'));
  });

  test('alteração cadastral: vira pendente, sem mudar o cadastro; a Diretoria vê a comparação e aprova', async () => {
    const r = await solicitarPelaInstituicao(repr, {
      tipo: 'alteracao_cadastral', alteracoes: { telefone: '(42) 99999-0000' }, justificativa: 'Novo contato',
    });
    assert.equal(r.solicitacao.status, 'pendente');
    assert.equal((await obterGovernancaInstituicao(admin, instA)).telefone, '(42) 3333-0000');

    const fila = await filaDeSolicitacoes(diretoria, BASE);
    const item = fila.dados.find((s) => s.id === r.solicitacao.id);
    assert.equal(item.instituicaoNome, `Gov A ${MARCA}`);
    assert.deepEqual(item.alteracoes, { telefone: '(42) 99999-0000' });
    assert.equal(item.comparacao[0].antes, '(42) 3333-0000');
    assert.ok(item.resumo.some((x) => x.rotulo === 'Instituição'));

    await assert.rejects(() => decidirPeloContrato(diretoria, r.solicitacao.id,
      { decisao: 'aprovar', versaoRegistro: item.versaoRegistro + 5 }), codigo('VERSAO_DESATUALIZADA'));
    const d = await decidirPeloContrato(diretoria, r.solicitacao.id, { decisao: 'aprovar', versaoRegistro: item.versaoRegistro });
    assert.equal(d.solicitacao.status, 'aprovada');
    assert.equal((await obterGovernancaInstituicao(admin, instA)).telefone, '(42) 99999-0000');
    await assert.rejects(() => decidirPeloContrato(diretoria, r.solicitacao.id, { decisao: 'aprovar' }),
      codigo('SOLICITACAO_JA_DECIDIDA'));
  });

  test('campo inexistente na ficha é recusado (sem mass assignment)', async () => {
    await assert.rejects(() => solicitarPelaInstituicao(repr, {
      tipo: 'alteracao_cadastral', alteracoes: { papel: 'admin' }, justificativa: 'x',
    }), codigo('DADOS_INVALIDOS'));
  });

  test('rejeitar exige parecer e devolve ajustes_solicitados', async () => {
    const r = await solicitarPelaInstituicao(repr, {
      tipo: 'alteracao_cadastral', alteracoes: { email: `novo.${MARCA}@exemplo.br` }, justificativa: 'x',
    });
    await assert.rejects(() => decidirPeloContrato(diretoria, r.solicitacao.id, { decisao: 'rejeitar' }),
      (e) => e.codigo === 'DADOS_INVALIDOS' && e.extra.campos[0].campo === 'parecer');
    const d = await decidirPeloContrato(diretoria, r.solicitacao.id, { decisao: 'rejeitar', parecer: 'E-mail errado' });
    assert.equal(d.solicitacao.status, 'ajustes_solicitados');
    const m = await minhaInstituicao(repr);
    const s = m.solicitacoes.find((x) => x.id === r.solicitacao.id);
    assert.equal(s.status, 'ajustes_solicitados');
    assert.equal(s.parecer, 'E-mail errado');
  });

  test('correção de presença sobre a falta esperada; aprovada vira presença', async () => {
    const lista = await presencasDaInstituicao(repr);
    const falta = lista.dados.find((p) => p.id === `esperada:${reuniaoId}:${titularId}`);
    assert.ok(falta);
    assert.equal(falta.statusPresenca, 'ausente');
    await assert.rejects(() => solicitarPelaInstituicao(reprOutra, {
      tipo: 'correcao_presenca', presencaId: falta.id, alteracoes: { statusPresenca: 'justificada' }, justificativa: 'x',
    }), codigo('NAO_ENCONTRADO'));
    const r = await solicitarPelaInstituicao(repr, {
      tipo: 'correcao_presenca', presencaId: falta.id,
      alteracoes: { statusPresenca: 'justificada', modalidade: 'online' }, justificativa: 'Estava em viagem',
    });
    const d = await decidirPeloContrato(diretoria, r.solicitacao.id, { decisao: 'aprovar' });
    assert.equal(d.solicitacao.status, 'aprovada');
    const depois = await presencasDaInstituicao(repr);
    assert.ok(depois.dados.some((p) => p.atividadeTitulo === `Reunião Gov ${MARCA}` && p.statusPresenca === 'justificada'));
  });

  test('substituição de representante: exige ofício da instituição e aplica na aprovação', async () => {
    const reps = await representantesDaInstituicao(repr);
    assert.ok(reps.dados.some((v) => v.vinculoId === vinculoTitular && v.status === 'ativo'));

    const corpo = {
      tipo: 'substituicao_representante', representanteAnteriorId: vinculoTitular,
      justificativa: 'Mudança de diretoria',
      novoRepresentante: { nome: `Nova Titular ${MARCA}`, email: `nova.${MARCA}@exemplo.br`, tipo: 'titular', cargo: 'Reitora' },
    };
    await assert.rejects(() => solicitarPelaInstituicao(repr, { ...corpo, oficioId: '00000000-0000-4000-8000-000000000000' }),
      codigo('DADOS_INVALIDOS'));

    const doc = await enviarDocumentoDoEscopo(repr, (u) => ({ dono: 'instituicao', id: u.instituicaoId }),
      { tipo: 'oficio' }, { nome: 'oficio.pdf', mime: 'application/pdf', conteudo: PDF });
    assert.equal(doc.documento.status, 'em_analise');

    const r = await solicitarPelaInstituicao(repr, { ...corpo, oficioId: doc.documento.id });
    await assert.rejects(() => solicitarPelaInstituicao(repr, { ...corpo, oficioId: doc.documento.id }),
      codigo('DADOS_INVALIDOS'));

    const fila = await filaDeSolicitacoes(diretoria, BASE);
    const item = fila.dados.find((s) => s.id === r.solicitacao.id);
    assert.ok(item.resumo.some((x) => x.rotulo === 'Representante anterior' && x.valor.includes('Titular Gov')));
    assert.match(item.documentos[0].downloadUrl, /^https:\/\/api\.exemplo\.br\/api\/governanca\/arquivos\//);

    await decidirPeloContrato(diretoria, r.solicitacao.id, { decisao: 'aprovar' });
    const ficha = await obterGovernancaInstituicao(admin, instA);
    assert.equal(ficha.titular, `Nova Titular ${MARCA}`);
    const hist = await representantesDaInstituicao(repr);
    assert.ok(hist.dados.some((v) => v.vinculoId === vinculoTitular && v.status === 'encerrado'));
  });
});

describe('documentos por escopo', { skip: !rodar }, () => {
  const minha = (u) => ({ dono: 'instituicao', id: u.instituicaoId });

  test('conteúdo que não é PDF/PNG/JPEG é recusado pelos bytes', async () => {
    await assert.rejects(() => enviarDocumentoDoEscopo(repr, minha, { tipo: 'oficio' },
      { nome: 'x.pdf', mime: 'application/pdf', conteudo: Buffer.from('<svg onload=alert(1)>') }),
    codigo('TIPO_NAO_PERMITIDO'));
  });

  test('tipo incompatível com o escopo é recusado', async () => {
    await assert.rejects(() => enviarDocumentoDoEscopo(repr, minha, { tipo: 'ata' },
      { nome: 'a.pdf', mime: 'application/pdf', conteudo: PDF }), codigo('DADOS_INVALIDOS'));
  });

  test('representante não envia para outra instituição', async () => {
    await assert.rejects(() => enviarDocumentoDoEscopo(repr, { dono: 'instituicao', id: instB }, { tipo: 'oficio' },
      { nome: 'a.pdf', mime: 'application/pdf', conteudo: PDF }), codigo('SEM_PERMISSAO'));
  });

  test('termo de adesão versiona; a lista mostra versões e link assinado que baixa', async () => {
    const v1 = Buffer.concat([PDF, Buffer.from('v1')]);
    const v2 = Buffer.concat([PDF, Buffer.from('v2')]);
    await enviarDocumentoDoEscopo(admin, { dono: 'instituicao', id: instA }, { tipo: 'termo_adesao' },
      { nome: 'termo.pdf', mime: 'application/pdf', conteudo: v1 });
    const r2 = await enviarDocumentoDoEscopo(admin, { dono: 'instituicao', id: instA }, { tipo: 'termo_adesao' },
      { nome: 'termo.pdf', mime: 'application/pdf', conteudo: v2 });
    assert.equal(r2.documento.versaoArquivo, 2);

    const lista = await listarDocumentosDoEscopo(repr, minha, BASE);
    assert.equal(lista.podeEnviar, true);
    const termo = lista.dados.find((d) => d.tipo === 'termo_adesao');
    assert.equal(termo.versoes.length, 2);
    const token = termo.downloadUrl.split('/').pop();
    const t = verificar(token);
    assert.equal(t.u, repr.id);
    const arq = await baixarDocumento(await usuarioPorId(t.u), t.id);
    assert.ok(arq.conteudo.subarray(0, 4).equals(Buffer.from('%PDF')));

    const outra = await listarDocumentosDoEscopo(reprOutra, (u) => ({ dono: 'instituicao', id: u.instituicaoId }), BASE);
    assert.ok(!outra.dados.some((d) => d.id === termo.id));
    // O link de A, usado pela conta de B, não abre (o RLS confere de novo).
    await assert.rejects(() => baixarDocumento(reprOutra, t.id), codigo('NAO_ENCONTRADO'));
  });

  test('logo do representante fica em análise', async () => {
    const r = await enviarDocumentoDoEscopo(repr, minha, { tipo: 'logo' },
      { nome: 'logo.png', mime: 'image/png', conteudo: PNG });
    assert.equal(r.documento.status, 'em_analise');
  });
});

describe('representante consultando outra instituição', { skip: !rodar }, () => {
  test('ficha sem nomes de representantes nem contatos internos', async () => {
    const r = await obterGovernancaInstituicao(reprOutra, instA);
    assert.equal(r.somenteConsulta, true);
    assert.equal(r.titular, '');
    assert.equal(r.suplente, '');
    assert.equal(r.contatosComunicacao, '');
    assert.equal(r.nomeFantasia, `Gov A ${MARCA}`);
    const propria = await obterGovernancaInstituicao(repr, instA);
    assert.ok(propria.titular);
    assert.equal(propria.somenteConsulta, undefined);
  });

  test('documentos: só os visíveis a membros, sem botão de envio', async () => {
    await db.query(
      `insert into documento (nome, tipo, url_externa, instituicao_id, visibilidade, status_analise)
       values ('Folder público', 'material', 'https://exemplo.br/folder.pdf', $1, 'membros', 'aprovado')`, [instA]);
    const l = await listarDocumentosDoEscopo(reprOutra, { dono: 'instituicao', id: instA }, BASE);
    assert.equal(l.podeEnviar, false);
    assert.deepEqual(l.dados.map((d) => d.nome), ['Folder público']);
  });
});

describe('contas, notificações, auditoria e observações', { skip: !rodar }, () => {
  test('contas: só o admin; papéis canônicos; concorrência por versão', async () => {
    await assert.rejects(() => listarContas(diretoria), codigo('SEM_PERMISSAO'));
    const c = await criarConta(admin, {
      nome: `Conta ${MARCA}`, email: `conta.${MARCA}@exemplo.br`, papel: 'representante_instituicao', instituicaoId: instB,
    });
    assert.equal(c.conta.papel, 'representante_instituicao');
    const l = await listarContas(admin);
    const item = l.dados.find((x) => x.id === c.conta.id);
    assert.equal(item.instituicaoNome, `Gov B ${MARCA}`);
    assert.ok(l.instituicoes.length > 0);
    const e = await editarConta(admin, c.conta.id, { papel: 'diretoria', instituicaoId: null, versaoRegistro: item.versaoRegistro });
    assert.equal(e.conta.papel, 'diretoria');
    await assert.rejects(() => editarConta(admin, c.conta.id, { nome: 'Outro nome', versaoRegistro: item.versaoRegistro }),
      codigo('VERSAO_DESATUALIZADA'));
  });

  test('notificações: só as próprias; preferências individuais', async () => {
    const n = await listarNotificacoes(repr);
    assert.ok(n.dados.length > 0, 'decisões anteriores notificaram o representante');
    assert.equal(n.dados[0].destino, '/minha-instituicao');
    await assert.rejects(() => marcarLida(reprOutra, n.dados[0].id), codigo('NAO_ENCONTRADO'));
    await marcarLida(repr, n.dados[0].id);
    const p = await salvarPreferencias(repr, { emailConvocacoes: false });
    assert.equal(p.preferencias.emailConvocacoes, false);
    assert.equal(p.preferencias.emailSolicitacoes, true);
    assert.equal((await listarNotificacoes(repr)).preferencias.emailConvocacoes, false);
  });

  test('auditoria: gestão lê, sem segredo, com cursor', async () => {
    await assert.rejects(() => consultarAuditoria(repr, {}), codigo('SEM_PERMISSAO'));
    const r = await consultarAuditoria(diretoria, { recurso: 'instituicoes', limite: 2 });
    assert.equal(r.dados.length, 2);
    assert.ok(r.proximoCursor);
    const r2 = await consultarAuditoria(diretoria, { recurso: 'instituicoes', limite: 2, cursor: r.proximoCursor });
    assert.ok(Number(r2.dados[0].id) < Number(r.dados[1].id));
    const contas = await consultarAuditoria(admin, { recurso: 'contas', limite: 50 });
    assert.ok(!JSON.stringify(contas).includes('senha_hash'));
  });

  test('observações internas: só a gestão, só acrescenta', async () => {
    await assert.rejects(() => adicionarObservacao(repr, instA, { texto: 'x' }), codigo('SEM_PERMISSAO'));
    await adicionarObservacao(diretoria, instA, { texto: 'Contato prefere e-mail' });
    const l = await listarObservacoes(admin, instA);
    assert.equal(l.dados[0].texto, 'Contato prefere e-mail');
    assert.equal(l.dados[0].autorNome, diretoria.nome);
  });
});
