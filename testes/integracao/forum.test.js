/**
 * Testes de integração da revisão de outubro — perfis do Fórum.
 *
 * Rodam contra um PostgreSQL de verdade, com a aplicação conectada como
 * app_web (RLS valendo). Cobrem o que a revisão apontou:
 *   - perfis e menus diferentes; representante preso à própria instituição;
 *   - área da instituição: o que muda direto e o que vira solicitação;
 *   - solicitações aprovadas aplicando a mudança (troca de titular, dados,
 *     correção de presença);
 *   - fluxo de cadastro (rascunho → em análise → ativa);
 *   - eventos separados de reuniões; credenciamento; check-in do logado;
 *   - painel público, logo, contas e exportação.
 *
 * Sem DATABASE_URL e DATABASE_URL_ADMIN, o arquivo é pulado inteiro.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fecharPool } from '@/infraestrutura/banco/pool.js';

import { montarPerfil } from '@/aplicacao/autenticacao/perfil.js';
import { criarInstituicao } from '@/aplicacao/instituicoes/criar-instituicao.js';
import { editarInstituicao } from '@/aplicacao/instituicoes/editar-instituicao.js';
import { obterInstituicao } from '@/aplicacao/instituicoes/obter-instituicao.js';
import { alterarStatusInstituicao } from '@/aplicacao/instituicoes/alterar-status-instituicao.js';
import { enviarParaAnalise } from '@/aplicacao/instituicoes/enviar-para-analise.js';
import { definirLogo, baixarLogo } from '@/aplicacao/instituicoes/logo.js';
import { criarRepresentante } from '@/aplicacao/representantes/criar-representante.js';
import { criarSolicitacao } from '@/aplicacao/solicitacoes/criar-solicitacao.js';
import { decidirSolicitacao } from '@/aplicacao/solicitacoes/decidir-solicitacao.js';
import { listarSolicitacoes } from '@/aplicacao/solicitacoes/listar-solicitacoes.js';
import { cancelarSolicitacao } from '@/aplicacao/solicitacoes/cancelar-solicitacao.js';
import { criarReuniao } from '@/aplicacao/reunioes/criar-reuniao.js';
import { listarReunioes } from '@/aplicacao/reunioes/listar-reunioes.js';
import { obterReuniao } from '@/aplicacao/reunioes/obter-reuniao.js';
import { encerrarReuniao } from '@/aplicacao/reunioes/encerrar-reuniao.js';
import { credenciamento } from '@/aplicacao/reunioes/credenciamento.js';
import { convidar } from '@/aplicacao/convites/convidar.js';
import { marcarPresenca } from '@/aplicacao/presencas/marcar-presenca.js';
import { consultarReuniao } from '@/aplicacao/checkin/consultar-reuniao.js';
import { registrarPresenca } from '@/aplicacao/checkin/registrar-presenca.js';
import { criarEncaminhamento, editarEncaminhamento } from '@/aplicacao/encaminhamentos/encaminhamentos.js';
import {
  painelPublico, instituicoesPublicas, logoPublica,
} from '@/aplicacao/publico/painel-publico.js';
import { criarUsuario, editarUsuario } from '@/aplicacao/usuarios/usuarios.js';
import { exportarParticipantes } from '@/aplicacao/relatorios/exportar.js';
import { participacaoPorInstituicao } from '@/aplicacao/relatorios/participacao.js';
import { gravarDominio } from '@/aplicacao/dominios/gravar-dominio.js';

const { Client } = pg;

const URL_APP = process.env.DATABASE_URL ?? '';
const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? '';
const rodar = URL_APP.length > 0 && URL_ADMIN.length > 0;

/** @type {import('pg').Client} */
let db;
const MARCA = `f${Date.now()}`;
const HOJE = new Date().toISOString().slice(0, 10);

/** @type {any} */ let admin;
/** @type {any} */ let diretoria;
/** @type {any} */ let repr;       // representante da instituição A, ligado à pessoa titular
/** @type {any} */ let reprOutra;  // representante de OUTRA instituição

/** @type {string} */ let instA;
/** @type {string} */ let instB;
/** @type {string} */ let titularId;   // pessoa titular de A
/** @type {string} */ let vinculoTitularId;

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);

/** @param {(e: any) => boolean} f */
const codigo = (c) => (/** @type {any} */ e) => e.codigo === c;

before(async () => {
  if (!rodar) return;
  db = new Client({ connectionString: URL_ADMIN });
  await db.connect();

  const { rows: t } = await db.query('select id from tipo_instituicao order by id limit 1');
  const { rows: a } = await db.query('select id from area_atuacao order by id limit 1');

  /** @param {string} nome */
  const inst = async (nome) => (await db.query(
    `insert into instituicao (nome, status, data_entrada, tipo_instituicao_id, area_atuacao_id,
                              autoriza_divulgacao)
     values ($1, 'ativa', '2020-01-01', $2, $3, true) returning id`,
    [nome, t[0].id, a[0].id])).rows[0].id;

  instA = await inst(`Instituição A ${MARCA}`);
  instB = await inst(`Instituição B ${MARCA}`);

  titularId = (await db.query(
    `insert into pessoa (nome, email) values ($1, $2) returning id`,
    [`Titular ${MARCA}`, `titular.${MARCA}@exemplo.br`])).rows[0].id;
  vinculoTitularId = (await db.query(
    `insert into vinculo (pessoa_id, instituicao_id, tipo_representacao, data_inicio, cargo)
     values ($1, $2, 'titular', '2020-01-01', 'Diretor') returning id`,
    [titularId, instA])).rows[0].id;

  /**
   * @param {string} papel
   * @param {string|null} instituicaoId
   * @param {string|null} [pessoaId]
   */
  const usuario = async (papel, instituicaoId, pessoaId = null) => (await db.query(
    `insert into usuario (nome, email, papel, instituicao_id, pessoa_id)
     values ($1, $2, $3, $4, $5)
     returning id, nome, email, papel, ativo,
               instituicao_id as "instituicaoId", pessoa_id as "pessoaId"`,
    [`Teste ${papel} ${MARCA}`, `${papel}.${Math.random().toString(36).slice(2, 7)}.${MARCA}@exemplo.br`,
      papel, instituicaoId, pessoaId])).rows[0];

  admin = await usuario('admin', null);
  diretoria = await usuario('diretoria', null);
  repr = await usuario('representante', instA, titularId);
  reprOutra = await usuario('representante', instB);
});

after(async () => {
  if (!rodar) return;
  // Banco de teste é descartável (npm run db:testar recria); a limpeza aqui é
  // só o necessário para rodar duas vezes seguidas sem colidir.
  // Os usuários ficam: são autores de instituição, reunião e presença criadas
  // aqui, e o e-mail com a MARCA já impede colisão na próxima execução.
  await db.end();
  await fecharPool();
});

// ---------------------------------------------------------------- perfis
describe('perfis e menus', { skip: !rodar }, () => {
  test('cada perfil recebe um menu diferente e a matriz de permissões', async () => {
    const pa = await montarPerfil(admin);
    const pd = await montarPerfil(diretoria);
    const pr = await montarPerfil(repr);

    assert.ok(pa.menu.some((i) => i.href === '/usuarios'));
    assert.ok(!pd.menu.some((i) => i.href === '/usuarios'));
    assert.ok(pr.menu.some((i) => i.href === '/minha-instituicao'));
    assert.equal(pr.instituicao.id, instA);
    assert.equal(pr.escopo, 'instituicao');
    assert.deepEqual(pr.permissoes.reuniao, ['ver']);
  });

  test('representante sem instituição recebe aviso', async () => {
    const p = await montarPerfil({ ...repr, instituicaoId: null });
    assert.equal(p.avisos.length, 1);
  });
});

// ----------------------------------------------------- área da instituição
describe('área da instituição', { skip: !rodar }, () => {
  test('representante atualiza contato, redes e autorização direto', async () => {
    await editarInstituicao(repr, instA, {
      telefone: '(42) 3000-1234',
      redesSociais: { instagram: 'https://instagram.com/inst_a' },
      contatosComunicacao: [{ nome: 'Assessoria', email: 'asc@exemplo.br' }],
      autorizaLogo: true,
    });
    const d = await obterInstituicao(repr, instA);
    assert.equal(d.telefone, '(42) 3000-1234');
    assert.equal(d.redesSociais.instagram, 'https://instagram.com/inst_a');
    assert.equal(d.contatosComunicacao[0].nome, 'Assessoria');
  });

  test('nome e CNPJ viram solicitação, com os campos apontados', async () => {
    await assert.rejects(
      () => editarInstituicao(repr, instA, { nome: 'Novo nome', telefone: '(42) 3000-0000' }),
      (/** @type {any} */ e) => e.codigo === 'ALTERACAO_EXIGE_APROVACAO'
        && e.extra.campos.some((c) => c.campo === 'nome')
        && e.extra.tipoSolicitacao === 'alterar_dados',
    );
  });

  test('rede social que não é http é recusada', async () => {
    await assert.rejects(
      () => editarInstituicao(repr, instA, { redesSociais: { instagram: 'javascript:alert(1)' } }),
      codigo('DADOS_INVALIDOS'),
    );
  });

  test('representante não edita outra instituição', async () => {
    await assert.rejects(() => editarInstituicao(repr, instB, { telefone: '1' }), codigo('SEM_PERMISSAO'));
  });

  test('ficha de outra instituição sai sem observação interna e sem pendências', async () => {
    await db.query(`update instituicao set observacoes = 'nota interna' where id = $1`, [instB]);
    const d = await obterInstituicao(repr, instB);
    assert.equal(d.observacoes, null);
    assert.equal(d.pendencias, null);
    assert.deepEqual(d.representantes, []);
  });

  test('logo: representante envia, fica em análise, e só vale depois de aprovada', async () => {
    const r = await definirLogo(repr, instA, { nome: 'logo.png', mime: 'image/png', conteudo: PNG });
    assert.equal(r.versao, 1);
    assert.equal(r.status, 'em_analise');
    await assert.rejects(() => baixarLogo(reprOutra, instA), codigo('NAO_ENCONTRADO'));

    const { rows } = await db.query(
      `select id from solicitacao where tipo = 'aprovacao_documento' and documento_id = $1`, [r.documentoId]);
    await decidirSolicitacao(diretoria, rows[0].id, { decisao: 'aprovar' });

    const l = await baixarLogo(reprOutra, instA); // outra instituição vê pela via pública (autorizada)
    assert.equal(l.mimeType, 'image/png');
    assert.ok(l.conteudo.equals(PNG));
  });

  test('logo: PDF não serve como logo', async () => {
    await assert.rejects(
      () => definirLogo(repr, instA, { nome: 'x.pdf', mime: 'application/pdf', conteudo: Buffer.from('%PDF-1') }),
      codigo('TIPO_NAO_PERMITIDO'),
    );
  });
});

// ------------------------------------------------------------- solicitações
describe('solicitações', { skip: !rodar }, () => {
  test('troca de titular: pedido do representante, aprovação aplica e encerra o anterior', async () => {
    const s = await criarSolicitacao(repr, {
      tipo: 'troca_titular',
      justificativa: 'Mudança de reitoria',
      dados: { pessoa: { nome: `Novo Titular ${MARCA}`, email: `novo.${MARCA}@exemplo.br` }, cargo: 'Reitor' },
    });
    assert.equal(s.status, 'pendente');

    // Duas trocas de titular abertas ao mesmo tempo não.
    await assert.rejects(
      () => criarSolicitacao(repr, { tipo: 'troca_titular', dados: { pessoaId: titularId } }),
      codigo('DADOS_INVALIDOS'),
    );

    await assert.rejects(() => decidirSolicitacao(repr, s.id, { decisao: 'aprovar' }), codigo('SEM_PERMISSAO'));

    const d = await decidirSolicitacao(diretoria, s.id, { decisao: 'aprovar' });
    assert.equal(d.status, 'aprovada');

    const { rows } = await db.query(
      `select v.status, v.tipo_representacao, p.nome from vinculo v join pessoa p on p.id = v.pessoa_id
        where v.instituicao_id = $1 order by v.created_at`, [instA]);
    assert.equal(rows.find((r) => r.nome === `Titular ${MARCA}`).status, 'encerrado');
    const novo = rows.find((r) => r.nome === `Novo Titular ${MARCA}`);
    assert.equal(novo.status, 'ativo');
    assert.equal(novo.tipo_representacao, 'titular');

    await assert.rejects(() => decidirSolicitacao(diretoria, s.id, { decisao: 'recusar', resposta: 'x' }),
      codigo('SOLICITACAO_JA_DECIDIDA'));

    // O representante foi avisado no sino.
    const n = await db.query('select 1 from notificacao where usuario_id = $1', [repr.id]);
    assert.ok(n.rowCount > 0);
  });

  test('alteração de dados aprovada muda o cadastro; recusa exige motivo', async () => {
    const s = await criarSolicitacao(repr, {
      tipo: 'alterar_dados', dados: { campos: { nomeFantasia: `Fantasia ${MARCA}` } },
    });
    await assert.rejects(() => decidirSolicitacao(diretoria, s.id, { decisao: 'recusar' }),
      codigo('DADOS_INVALIDOS'));
    await decidirSolicitacao(diretoria, s.id, { decisao: 'aprovar' });
    const { rows } = await db.query('select nome_fantasia from instituicao where id = $1', [instA]);
    assert.equal(rows[0].nome_fantasia, `Fantasia ${MARCA}`);
  });

  test('campo que não muda por solicitação é recusado na entrada', async () => {
    await assert.rejects(
      () => criarSolicitacao(repr, { tipo: 'alterar_dados', dados: { campos: { status: 'ativa' } } }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS' && e.extra.campos[0].campo.startsWith('dados'),
    );
  });

  test('representante não abre solicitação para outra instituição', async () => {
    await assert.rejects(
      () => criarSolicitacao(repr, { tipo: 'saida_forum', instituicaoId: instB, dados: { motivo: 'teste' } }),
      codigo('SEM_PERMISSAO'),
    );
  });

  test('cancelar a própria e a lista mostra só as da instituição', async () => {
    const s = await criarSolicitacao(repr, { tipo: 'saida_forum', dados: { motivo: 'Encerramento' } });
    const c = await cancelarSolicitacao(repr, s.id);
    assert.equal(c.status, 'cancelada');

    const lista = await listarSolicitacoes(reprOutra, {});
    assert.ok(lista.dados.every((x) => x.instituicaoId === instB));
  });

  test('correção de presença: representante pede, diretoria aprova', async () => {
    const r = await criarReuniao(diretoria, { titulo: `Ordinária ${MARCA}`, data: HOJE });
    // A pessoa do pedido tem que ser da instituição que pede.
    const novo = (await db.query(
      `select p.id from pessoa p join vinculo v on v.pessoa_id = p.id
        where v.instituicao_id = $1 and v.status = 'ativo' and v.tipo_representacao = 'titular'`,
      [instA])).rows[0].id;

    await assert.rejects(() => marcarPresenca(repr, r.id, { pessoaId: novo, status: 'presente' }),
      codigo('ALTERACAO_EXIGE_APROVACAO'));

    const s = await criarSolicitacao(repr, {
      tipo: 'correcao_presenca',
      dados: { reuniaoId: r.id, pessoaId: novo, status: 'justificado', observacoes: 'Viagem' },
    });
    await decidirSolicitacao(diretoria, s.id, { decisao: 'aprovar' });
    const { rows } = await db.query(
      'select status, registrado_por from presenca where reuniao_id = $1 and pessoa_id = $2', [r.id, novo]);
    assert.equal(rows[0].status, 'justificado');
    assert.equal(rows[0].registrado_por, diretoria.id, 'quem corrigiu fica registrado');

    await db.query('delete from presenca where reuniao_id = $1', [r.id]);
    await db.query('delete from solicitacao where reuniao_id = $1', [r.id]);
    await db.query('delete from reuniao where id = $1', [r.id]);
  });
});

// --------------------------------------------------------- fluxo de cadastro
describe('fluxo de cadastro da instituição', { skip: !rodar }, () => {
  test('rascunho só com nome, pendências, análise e aprovação', async () => {
    const c = await criarInstituicao(diretoria, { nome: `Rascunho ${MARCA}` });
    assert.equal(c.status, 'rascunho');

    const conta = { ...reprOutra, instituicaoId: c.id };
    await db.query('update usuario set instituicao_id = $2 where id = $1', [reprOutra.id, c.id]);
    try {
      await assert.rejects(
        () => enviarParaAnalise(conta, c.id),
        (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS'
          && e.extra.pendencias.some((p) => p.campo === 'titular')
          && e.extra.pendencias.some((p) => p.campo === 'documento:oficio'),
      );

      // Durante o rascunho, a própria instituição preenche até o CNPJ.
      await editarInstituicao(conta, c.id, { cnpj: gerarCnpj() });
    } finally {
      await db.query('update usuario set instituicao_id = $2 where id = $1', [reprOutra.id, instB]);
    }

    // A gestão leva adiante: análise, e aprovar grava o ingresso no Fórum.
    await alterarStatusInstituicao(diretoria, c.id, { status: 'em_analise' });
    await assert.rejects(() => alterarStatusInstituicao(diretoria, c.id, { status: 'desligada', motivo: 'x' }),
      codigo('TRANSICAO_INVALIDA'));
    const ativa = await alterarStatusInstituicao(diretoria, c.id, { status: 'ativa' });
    assert.equal(ativa.status, 'ativa');
    assert.equal(ativa.dataEntrada, HOJE);

    await assert.rejects(() => alterarStatusInstituicao(diretoria, c.id, { status: 'desligada' }),
      codigo('DADOS_INVALIDOS'), 'desligar exige motivo');
    const fora = await alterarStatusInstituicao(diretoria, c.id, { status: 'desligada', motivo: 'Pedido da instituição' });
    assert.equal(fora.status, 'desligada');
    assert.ok(fora.dataSaida);
  });
});

// --------------------------------------------------------- reunião x evento
describe('eventos e credenciamento', { skip: !rodar }, () => {
  /** @type {string} */ let eventoId;

  test('evento é criado com tipo de evento e não conta no percentual', async () => {
    const { rows } = await db.query(`select id from tipo_atividade where nome = 'Workshop'`);
    const e = await criarReuniao(diretoria, {
      titulo: `Workshop ${MARCA}`, data: HOJE, tipoAtividadeId: rows[0].id,
      organizacaoResponsavel: 'Centro de Inovação', exibirPublico: true,
    }, 'evento');
    eventoId = e.id;
    assert.equal(e.natureza, 'evento');
    assert.equal(e.contaParticipacao, false);
  });

  test('tipo de reunião não serve para evento', async () => {
    const { rows } = await db.query(`select id from tipo_atividade where nome = 'Reunião ordinária'`);
    await assert.rejects(
      () => criarReuniao(diretoria, { titulo: `X ${MARCA}`, data: HOJE, tipoAtividadeId: rows[0].id }, 'evento'),
      codigo('DADOS_INVALIDOS'),
    );
  });

  test('listas separadas: evento não aparece em reuniões', async () => {
    const ev = await listarReunioes(diretoria, { busca: MARCA }, 'evento');
    const re = await listarReunioes(diretoria, { busca: `Workshop ${MARCA}` }, 'reuniao');
    assert.ok(ev.dados.some((x) => x.id === eventoId));
    assert.equal(re.total, 0);
    await assert.rejects(() => obterReuniao(diretoria, eventoId, 'reuniao'), codigo('REUNIAO_NAO_ENCONTRADA'));
  });

  test('representante não cria evento nem conduz o credenciamento', async () => {
    await assert.rejects(() => criarReuniao(repr, { titulo: 'x', data: HOJE }, 'evento'), codigo('SEM_PERMISSAO'));
    await assert.rejects(() => credenciamento(repr, eventoId, { acao: 'abrir' }), codigo('SEM_PERMISSAO'));
  });

  test('representante vê a atividade mas não recebe o token do QR', async () => {
    const d = await obterReuniao(repr, eventoId, 'evento');
    assert.equal(d.checkin.token, null);
    const g = await obterReuniao(diretoria, eventoId, 'evento');
    assert.ok(g.checkin.token);
  });

  test('abrir, check-in do logado, fechar e QR novo', async () => {
    const aberto = await credenciamento(diretoria, eventoId, { acao: 'abrir' });
    assert.equal(aberto.aberto, true);
    assert.equal(aberto.status, 'em_andamento');

    const titularAtual = (await db.query(
      `select p.id from pessoa p join vinculo v on v.pessoa_id = p.id
        where v.instituicao_id = $1 and v.status = 'ativo' and v.tipo_representacao = 'titular'`,
      [instA])).rows[0].id;
    const logado = { ...repr, pessoaId: titularAtual };
    await db.query('update usuario set pessoa_id = $2 where id = $1', [repr.id, titularAtual]);

    const tela = await consultarReuniao(aberto.token, logado);
    assert.equal(tela.voce.podeRegistrar, true);
    assert.equal(tela.voce.jaRegistrado, false);

    const r = await registrarPresenca(aberto.token, { proprio: true, assinar: true }, { usuario: logado, ip: '10.1.1.1' });
    assert.equal(r.tipo, 'representante');
    assert.equal(r.assinado, true);

    // "Própria presença": sem login, `proprio` não vale.
    await assert.rejects(() => registrarPresenca(aberto.token, { proprio: true }, {}), codigo('NAO_AUTENTICADO'));

    const fechado = await credenciamento(diretoria, eventoId, { acao: 'fechar' });
    assert.equal(fechado.aberto, false);
    await assert.rejects(
      () => registrarPresenca(aberto.token, { convidado: { nome: 'Tarde Demais' } }),
      codigo('CHECKIN_FECHADO'),
    );

    const novo = await credenciamento(diretoria, eventoId, { acao: 'novo_qr' });
    assert.notEqual(novo.token, aberto.token);
    await assert.rejects(() => consultarReuniao(aberto.token), codigo('REUNIAO_NAO_ENCONTRADA'));
  });

  test('encerrar evento marca ausente só quem foi convidado', async () => {
    await convidar(diretoria, eventoId, { instituicaoIds: [instA] });
    const enc = await encerrarReuniao(diretoria, eventoId);
    assert.equal(enc.contaParticipacao, false);
    const { rows } = await db.query(
      `select count(*)::int as n from presenca where reuniao_id = $1 and status = 'ausente'`, [eventoId]);
    const { rows: conv } = await db.query(
      `select count(*)::int as n from reuniao_convite where reuniao_id = $1`, [eventoId]);
    assert.ok(rows[0].n <= conv[0].n, 'ausentes não podem passar do número de convidados');
  });

  test('encaminhamento com responsável e prazo; concluir grava a data', async () => {
    const e = await criarEncaminhamento(diretoria, eventoId, {
      descricao: 'Enviar material aos participantes', responsavel: 'Secretaria', prazo: HOJE,
    });
    const c = await editarEncaminhamento(diretoria, e.id, { status: 'concluido' });
    assert.equal(c.concluidoEm, HOJE);
    await assert.rejects(() => criarEncaminhamento(repr, eventoId, { descricao: 'x x x' }), codigo('SEM_PERMISSAO'));
  });

  test('lista de presença em CSV para o Excel', async () => {
    const arq = await exportarParticipantes(diretoria, eventoId, {});
    assert.ok(arq.conteudo.startsWith('﻿Nome;Instituição'));
    assert.match(arq.mimeType, /text\/csv/);
  });
});

// --------------------------------------------------------- painel público
describe('painel público', { skip: !rodar }, () => {
  test('instituições autorizadas aparecem, com a logo autorizada', async () => {
    const r = await instituicoesPublicas({ busca: MARCA });
    const a = r.dados.find((x) => x.id === instA);
    assert.ok(a, 'a instituição autorizada deveria aparecer');
    assert.ok(a.logoUrl);
    assert.equal(a.cnpj, undefined, 'CNPJ não sai no painel');
    const logo = await logoPublica(instA);
    assert.ok(logo.conteudo.equals(PNG));
  });

  test('sem autorização a instituição some do painel, e a logo também', async () => {
    await db.query('update instituicao set autoriza_divulgacao = false where id = $1', [instB]);
    const r = await instituicoesPublicas({ busca: MARCA });
    assert.ok(!r.dados.some((x) => x.id === instB));
    await assert.rejects(() => logoPublica(instB), codigo('NAO_ENCONTRADO'));
  });

  test('a página inicial do painel vem numa chamada só', async () => {
    const p = await painelPublico();
    assert.equal(typeof p.indicadores.instituicoesIntegrantes, 'number');
    assert.ok(Array.isArray(p.diretoria));
    assert.ok(Array.isArray(p.proximasAtividades));
    assert.ok(Array.isArray(p.canaisOficiais));
  });
});

// ------------------------------------------------------------- contas e listas
describe('contas, listas e relatórios', { skip: !rodar }, () => {
  test('só o admin cria conta; representante exige instituição', async () => {
    await assert.rejects(
      () => criarUsuario(diretoria, { nome: 'X Y', email: `x.${MARCA}@exemplo.br`, papel: 'diretoria' }),
      codigo('SEM_PERMISSAO'));
    await assert.rejects(
      () => criarUsuario(admin, { nome: 'Sem Inst', email: `si.${MARCA}@exemplo.br`, papel: 'representante' }),
      codigo('DADOS_INVALIDOS'));

    const c = await criarUsuario(admin, {
      nome: 'Conta Nova', email: `nova.${MARCA}@exemplo.br`, papel: 'representante', instituicaoId: instB,
    });
    assert.equal(c.instituicao.id, instB);
    assert.equal(c.senhaDefinida, false, 'a senha é definida pela própria pessoa, pelo link');

    const ed = await editarUsuario(admin, c.id, { papel: 'diretoria' });
    assert.equal(ed.instituicao, null, 'conta da gestão não fica presa a uma instituição');
  });

  test('admin não rebaixa a própria conta', async () => {
    await assert.rejects(() => editarUsuario(admin, admin.id, { papel: 'diretoria' }), codigo('DADOS_INVALIDOS'));
  });

  test('diretoria cadastra vertente e GT; representante não', async () => {
    const v = await gravarDominio(diretoria, { lista: 'vertentes', nome: `Vertente ${MARCA}` });
    assert.ok(v.id);
    await assert.rejects(() => gravarDominio(repr, { lista: 'vertentes', nome: 'x x' }), codigo('SEM_PERMISSAO'));
    await db.query('delete from vertente where id = $1', [v.id]);
  });

  test('relatório de participação: representante só a própria', async () => {
    const r = await participacaoPorInstituicao(repr, {});
    assert.equal(r.dados.length, 1);
    assert.equal(r.dados[0].instituicaoId, instA);
    const g = await participacaoPorInstituicao(diretoria, {});
    assert.ok(g.dados.length > 1);
  });

  test('representante cria representante? não — pede por solicitação', async () => {
    await assert.rejects(
      () => criarRepresentante(repr, { nome: 'Fulano de Tal', vinculo: { instituicaoId: instA } }),
      codigo('SEM_PERMISSAO'));
  });
});

/** CNPJ com dígito verificador correto, sorteado (não colide com outros testes). */
function gerarCnpj() {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  /** @param {string} parcial @param {number[]} pesos */
  const digito = (parcial, pesos) => {
    const soma = parcial.split('').reduce((a, n, i) => a + Number(n) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}
