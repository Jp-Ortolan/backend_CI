/**
 * Testes de integração do Bloco B — reuniões, convites e histórico.
 *
 *   DATABASE_URL=postgresql://app_web:...@localhost:5432/ecossistema \
 *   DATABASE_URL_ADMIN=postgresql://postgres:...@localhost:5432/ecossistema \
 *   npm run test:integracao
 *
 * Mesmas duas conexões dos testes de instituição, e pelo mesmo motivo:
 * DATABASE_URL usa `app_web`, que não é dono das tabelas, senão o RLS seria
 * ignorado e os casos de permissão passariam sem provar nada.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fecharPool } from '@/infraestrutura/banco/pool.js';

import { criarReuniao } from '@/aplicacao/reunioes/criar-reuniao.js';
import { listarReunioes } from '@/aplicacao/reunioes/listar-reunioes.js';
import { obterReuniao } from '@/aplicacao/reunioes/obter-reuniao.js';
import { editarReuniao } from '@/aplicacao/reunioes/editar-reuniao.js';
import { alterarStatusReuniao } from '@/aplicacao/reunioes/alterar-status-reuniao.js';
import { excluirReuniao } from '@/aplicacao/reunioes/excluir-reuniao.js';
import { encerrarReuniao } from '@/aplicacao/reunioes/encerrar-reuniao.js';
import { convidar } from '@/aplicacao/convites/convidar.js';
import { responderConvite } from '@/aplicacao/convites/responder-convite.js';
import { removerConvite } from '@/aplicacao/convites/remover-convite.js';
import { listarParticipantes } from '@/aplicacao/convites/listar-participantes.js';
import { obterRepresentante } from '@/aplicacao/representantes/obter-representante.js';
import { editarRepresentante } from '@/aplicacao/representantes/editar-representante.js';
import { criarInstituicao } from '@/aplicacao/instituicoes/criar-instituicao.js';
import { criarRepresentante } from '@/aplicacao/representantes/criar-representante.js';

const { Client } = pg;

const URL_APP = process.env.DATABASE_URL ?? '';
const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? '';
const rodar = URL_APP.length > 0 && URL_ADMIN.length > 0;

/** @type {import('pg').Client} */
let db;
const MARCA = `r${Date.now()}`;

/** @type {any} */ let admin;
/** @type {any} */ let gestor;
/** @type {any} */ let leitura;
/** @type {string} */ let instId;
/** @type {string} */ let pessoaId;
/** @type {string} */ let vinculoId;
/** @type {string[]} */ const reunioesCriadas = [];

const hoje = () => new Date().toISOString().slice(0, 10);
/** @param {number} dias */
const emDias = (dias) =>
  new Date(Date.now() + dias * 86400_000).toISOString().slice(0, 10);

function gerarCnpj() {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  /** @param {string} p @param {number[]} w */
  const d = (p, w) => {
    const s = p.split('').reduce((a, n, i) => a + Number(n) * w[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const d1 = d(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = d(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
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

  /** @param {'admin'|'gestor'|'leitura'} papel */
  const criarUsuario = async (papel) => {
    const { rows } = await db.query(
      `insert into usuario (nome, email, papel)
       values ($1, $2, $3) returning id, nome, email, papel, ativo`,
      [`Teste ${papel} ${MARCA}`, `${papel}.${MARCA}@exemplo.br`, papel],
    );
    return rows[0];
  };
  admin = await criarUsuario('admin');
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
    // Vínculo começando ontem, para a pessoa já ser "esperada" numa reunião
    // marcada para hoje.
    vinculo: { instituicaoId: instId, cargo: 'Coordenador', dataInicio: emDias(-1) },
  });
  pessoaId = rep.pessoaId;
  vinculoId = rep.vinculo.id;
});

after(async () => {
  if (!rodar) return;
  for (const id of reunioesCriadas) {
    await db.query('delete from presenca where reuniao_id = $1', [id]);
    await db.query('delete from reuniao_convite where reuniao_id = $1', [id]);
    await db.query('delete from reuniao where id = $1', [id]);
  }
  await db.query('delete from presenca where pessoa_id = $1', [pessoaId]);
  await db.query('delete from reuniao_convite where pessoa_id = $1', [pessoaId]);
  await db.query('delete from vinculo where pessoa_id = $1', [pessoaId]);
  await db.query('delete from pessoa where id = $1', [pessoaId]);
  await db.query('delete from vinculo where instituicao_id = $1', [instId]);
  await db.query('delete from instituicao where id = $1', [instId]);
  await db.query('delete from usuario where email like $1', [`%.${MARCA}@exemplo.br`]);
  await db.end();
  // Sem isto o processo fica 30 segundos de pé esperando o pool ocioso.
  await fecharPool();
});

/** @param {string} id */
const anotar = (id) => { reunioesCriadas.push(id); return id; };

/** @param {Record<string, unknown>} [ajustes] */
const reuniaoValida = (ajustes = {}) => ({
  titulo: `Reuniao ${MARCA}`,
  descricao: 'Reunião criada pelos testes.',
  data: emDias(7),
  horaInicio: '13:00',
  horaFim: '15:00',
  local: 'Auditório',
  endereco: 'Centro de Inovação',
  ...ajustes,
});

// ---------------------------------------------------------------- cadastro
describe('cadastro de reunião', { skip: !rodar }, () => {
  test('cria e aparece na listagem de próximas', async () => {
    const r = await criarReuniao(gestor, reuniaoValida());
    anotar(r.id);

    assert.equal(r.status, 'agendada');
    assert.equal(r.convidados, 0, 'sem convidarTodos não convida ninguém');

    const lista = await listarReunioes(gestor, { busca: MARCA, periodo: 'proximas' });
    assert.equal(lista.total, 1);
    assert.equal(lista.dados[0].local, 'Auditório');
    assert.equal(lista.dados[0].percentualComparecimento, null,
      'reunião que ainda não aconteceu não tem percentual');
  });

  test('convidarTodos já traz os representantes ativos', async () => {
    const r = await criarReuniao(gestor, reuniaoValida({
      titulo: `Com convites ${MARCA}`, convidarTodos: true,
    }));
    anotar(r.id);

    assert.ok(r.convidados >= 1, `esperava ao menos 1 convidado, veio ${r.convidados}`);

    const d = await obterReuniao(gestor, r.id);
    assert.equal(d.resumo.convitesEnviados, r.convidados);
    assert.equal(d.resumo.confirmados, 0, 'convite novo nasce pendente');
  });

  test('horário de término antes do início é recusado', async () => {
    await assert.rejects(
      () => criarReuniao(gestor, reuniaoValida({ horaInicio: '15:00', horaFim: '13:00' })),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('perfil de consulta não cria reunião', async () => {
    await assert.rejects(
      () => criarReuniao(leitura, reuniaoValida()),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );
  });
});

// ------------------------------------------------------------------ detalhe
describe('detalhe e QR Code', { skip: !rodar }, () => {
  test('devolve o token e a URL de check-in', async () => {
    const r = await criarReuniao(gestor, reuniaoValida({ titulo: `QR ${MARCA}` }));
    anotar(r.id);

    const d = await obterReuniao(gestor, r.id);
    assert.ok(d.checkin.token && d.checkin.token.length >= 16,
      'o token do QR deveria ser aleatório e longo');
    assert.ok(d.checkin.url.endsWith(`/checkin/${d.checkin.token}`));
    assert.equal(d.checkin.janelaPadrao, true,
      'sem janela definida, vale o dia da reunião');

    // O token não pode ser derivado do id: quem conhece uma URL adivinharia as
    // outras.
    assert.ok(!d.checkin.token.includes(r.id.slice(0, 8)));
  });

  test('reunião inexistente devolve 404', async () => {
    await assert.rejects(
      () => obterReuniao(gestor, '00000000-0000-0000-0000-000000000000'),
      (/** @type {any} */ e) => e.codigo === 'REUNIAO_NAO_ENCONTRADA' && e.status === 404,
    );
  });
});

// ------------------------------------------------------- convites e resposta
describe('convites e confirmação', { skip: !rodar }, () => {
  /** @type {string} */ let reuniaoId;
  /** @type {string} */ let conviteId;

  before(async () => {
    if (!rodar) return;
    const r = await criarReuniao(gestor, reuniaoValida({ titulo: `Convites ${MARCA}` }));
    reuniaoId = anotar(r.id);
  });

  test('convida uma lista escolhida a dedo', async () => {
    const r = await convidar(gestor, reuniaoId, { vinculoIds: [vinculoId] });
    assert.equal(r.convidadosAgora, 1);
    assert.equal(r.confirmados, 0);

    const { rows } = await db.query(
      'select id from reuniao_convite where reuniao_id = $1 and vinculo_id = $2',
      [reuniaoId, vinculoId],
    );
    conviteId = rows[0].id;
  });

  test('convidar de novo não duplica e diz quantos já estavam', async () => {
    const r = await convidar(gestor, reuniaoId, { vinculoIds: [vinculoId] });
    assert.equal(r.convidadosAgora, 0, 'ninguém novo');
    assert.equal(r.convitesEnviados, 1, 'mas o convite anterior continua lá');
  });

  test('confirmar sobe o contador do dashboard', async () => {
    const r = await responderConvite(gestor, conviteId, { status: 'confirmado' });
    assert.equal(r.status, 'confirmado');
    assert.ok(r.respondidoEm, 'confirmação sem data quebraria a constraint do banco');

    const d = await obterReuniao(gestor, reuniaoId);
    assert.equal(d.resumo.confirmados, 1);
  });

  test('voltar para pendente limpa a data da resposta', async () => {
    const r = await responderConvite(gestor, conviteId, { status: 'pendente' });
    assert.equal(r.respondidoEm, null,
      'pendente com data de resposta quebraria convite_respondido_tem_data');
    await responderConvite(gestor, conviteId, { status: 'confirmado' });
  });

  test('confirmado ainda não é presente', async () => {
    const lista = await listarParticipantes(gestor, reuniaoId, {});
    const p = lista.dados[0];
    assert.equal(p.statusConfirmacao, 'confirmado');
    assert.equal(p.statusPresenca, null,
      'confirmar não pode registrar presença — quem confirma e falta é ausência');
    assert.equal(lista.totais.confirmados, 1);
    assert.equal(lista.totais.presentes, 0);
    assert.equal(lista.totais.nao_registrados, 1);
  });

  test('perfil de consulta não convida nem responde', async () => {
    await assert.rejects(
      () => convidar(leitura, reuniaoId, { vinculoIds: [vinculoId] }),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );
    await assert.rejects(
      () => responderConvite(leitura, conviteId, { status: 'recusado' }),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );
  });

  test('gestor não remove convite, admin remove', async () => {
    await assert.rejects(
      () => removerConvite(gestor, conviteId),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );

    // O que importa é o efeito, não a exceção: a linha continua lá.
    const { rows: antes } = await db.query(
      'select id from reuniao_convite where id = $1', [conviteId],
    );
    assert.equal(antes.length, 1, 'o convite não podia ter sumido');

    const r = await removerConvite(admin, conviteId);
    assert.equal(r.removido, true);
  });
});

// ------------------------------------------------- situação e encerramento
describe('situação e encerramento', { skip: !rodar }, () => {
  test('cancelar e reabrir', async () => {
    const r = await criarReuniao(gestor, reuniaoValida({ titulo: `Cancela ${MARCA}` }));
    anotar(r.id);

    const c = await alterarStatusReuniao(gestor, r.id, {
      status: 'cancelada', motivo: 'Sem quórum',
    });
    assert.equal(c.status, 'cancelada');

    // Reunião cancelada não aceita edição nem convite enquanto estiver assim.
    await assert.rejects(
      () => editarReuniao(gestor, r.id, { local: 'Outro lugar' }),
      (/** @type {any} */ e) => e.codigo === 'REUNIAO_CANCELADA',
    );
    await assert.rejects(
      () => convidar(gestor, r.id, { vinculoIds: [vinculoId] }),
      (/** @type {any} */ e) => e.codigo === 'REUNIAO_CANCELADA',
    );

    const v = await alterarStatusReuniao(gestor, r.id, { status: 'agendada' });
    assert.equal(v.status, 'agendada');
  });

  test('encerrar marca os ausentes e fecha o denominador', async () => {
    const r = await criarReuniao(gestor, reuniaoValida({
      titulo: `Encerra ${MARCA}`, data: hoje(), convidarTodos: true,
    }));
    anotar(r.id);

    const fim = await encerrarReuniao(gestor, r.id);
    assert.equal(fim.status, 'encerrada');
    assert.ok(fim.ausentesMarcados >= 1,
      'quem era esperado e não registrou presença tem que virar ausência');
    assert.ok(fim.esperados >= 1);
    // Ninguém compareceu: o indicador correto é 0, e não 100% por falta de
    // denominador, que era o defeito da fórmula antiga.
    assert.equal(Number(fim.percentualComparecimento), 0);
  });

  test('encerrar duas vezes é recusado', async () => {
    const lista = await listarReunioes(gestor, { busca: `Encerra ${MARCA}` });
    const id = lista.dados[0].id;
    await assert.rejects(
      () => encerrarReuniao(gestor, id),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('reunião encerrada não muda data nem situação', async () => {
    const lista = await listarReunioes(gestor, { busca: `Encerra ${MARCA}` });
    const id = lista.dados[0].id;

    await assert.rejects(
      () => editarReuniao(gestor, id, { data: emDias(3) }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
    await assert.rejects(
      () => alterarStatusReuniao(gestor, id, { status: 'agendada' }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );

    // Editar o que não afeta indicador continua permitido.
    const ok = await editarReuniao(gestor, id, { local: 'Sala 2' });
    assert.equal(ok.status, 'encerrada');
  });
});

// ----------------------------------------------------------------- exclusão
describe('exclusão de reunião', { skip: !rodar }, () => {
  test('reunião com presença é protegida e sugere cancelar', async () => {
    const lista = await listarReunioes(gestor, { busca: `Encerra ${MARCA}` });
    const id = lista.dados[0].id;

    const { rows: antes } = await db.query(
      'select count(*)::int as n from presenca where reuniao_id = $1', [id],
    );
    assert.ok(antes[0].n > 0, 'o cenário precisa de presenças registradas');

    await assert.rejects(
      () => excluirReuniao(admin, id),
      (/** @type {any} */ e) => {
        assert.equal(e.codigo, 'REUNIAO_COM_PRESENCA');
        assert.equal(e.extra?.acaoSugerida, 'cancelar');
        return true;
      },
    );

    // O ponto do teste: presenca.reuniao_id é "on delete cascade". Sem a
    // proteção, a tentativa acima teria apagado o histórico em silêncio.
    const { rows: depois } = await db.query(
      'select count(*)::int as n from presenca where reuniao_id = $1', [id],
    );
    assert.equal(depois[0].n, antes[0].n, 'nenhuma presença podia ter sumido');
  });

  test('reunião marcada por engano pode ser excluída', async () => {
    const r = await criarReuniao(admin, reuniaoValida({ titulo: `Engano ${MARCA}` }));
    const saida = await excluirReuniao(admin, r.id);
    assert.equal(saida.excluida, true);
  });

  test('convite não impede a exclusão — presença impede', async () => {
    const r = await criarReuniao(admin, reuniaoValida({
      titulo: `SoConvite ${MARCA}`, convidarTodos: true,
    }));
    const saida = await excluirReuniao(admin, r.id);
    assert.equal(saida.excluida, true,
      'convite é intenção, não fato: pode ser apagado junto');
  });
});

// -------------------------------------------------- histórico do representante
describe('histórico do representante', { skip: !rodar }, () => {
  test('separa a participação por vínculo, não por pessoa', async () => {
    const d = await obterRepresentante(gestor, pessoaId);

    assert.equal(d.nome, `Representante ${MARCA}`);
    assert.equal(d.vinculoAtual?.cargo, 'Coordenador');
    assert.ok(d.participacaoPorInstituicao.length >= 1,
      'deveria haver uma linha por instituição pela qual a pessoa passou');

    const linha = d.participacaoPorInstituicao.find(
      (/** @type {any} */ l) => l.instituicaoId === instId);
    assert.ok(linha, 'a instituição do vínculo deveria estar no histórico');
    assert.ok(linha.reunioesEsperadas >= 1,
      'a reunião encerrada de hoje entra como esperada');
    assert.ok(d.historico.length >= 1, 'a linha do tempo não pode vir vazia');
  });

  test('edita os dados da pessoa', async () => {
    const r = await editarRepresentante(gestor, pessoaId, { telefone: '(42) 91234-5678' });
    assert.equal(r.telefone, '(42) 91234-5678');

    const d = await obterRepresentante(gestor, pessoaId);
    assert.equal(d.nome, `Representante ${MARCA}`, 'o nome não podia ter mudado');
  });

  test('PATCH de um campo não apaga os outros', async () => {
    // A armadilha real: com .optional().transform() na ordem errada, os campos
    // ausentes chegavam como null e limpavam e-mail e observações sem erro.
    const antes = await obterRepresentante(gestor, pessoaId);
    assert.ok(antes.email, 'o cenário precisa de um e-mail gravado');

    await editarRepresentante(gestor, pessoaId, { nome: `Renomeado ${MARCA}` });

    const depois = await obterRepresentante(gestor, pessoaId);
    assert.equal(depois.nome, `Renomeado ${MARCA}`);
    assert.equal(depois.email, antes.email, 'o e-mail não podia ter sido apagado');
    assert.equal(depois.telefone, antes.telefone, 'o telefone não podia ter sido apagado');
  });

  test('string vazia limpa o campo de propósito', async () => {
    await editarRepresentante(gestor, pessoaId, { observacoes: 'anotação' });
    assert.equal((await obterRepresentante(gestor, pessoaId)).observacoes, 'anotação');

    await editarRepresentante(gestor, pessoaId, { observacoes: '' });
    assert.equal((await obterRepresentante(gestor, pessoaId)).observacoes, null,
      'enviar vazio é pedido explícito para limpar, diferente de não enviar');
  });

  test('corpo vazio não finge que salvou', async () => {
    await assert.rejects(
      () => editarRepresentante(gestor, pessoaId, {}),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('perfil de consulta lê mas não edita', async () => {
    const d = await obterRepresentante(leitura, pessoaId);
    assert.ok(d.id);

    await assert.rejects(
      () => editarRepresentante(leitura, pessoaId, { telefone: '(42) 90000-0000' }),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );
  });
});
