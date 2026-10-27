/**
 * Reuniões e eventos no contrato /api/governanca:
 *
 *   GET        /eventos            GET /eventos/configuracao
 *   POST       /eventos            GET/PATCH /eventos/:id
 *   GET/PATCH  /reunioes/:id/governanca
 *
 * Reunião e evento continuam na mesma tabela (natureza), e o caminho não
 * mistura: /eventos/:id de uma reunião é 404. As regras de situação são as
 * de alterar-status-reuniao.js e encerrar-reuniao.js (encerrar lança as
 * ausências); aqui só a tradução dos nomes do contrato.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { encerrarReuniao } from '@/aplicacao/reunioes/encerrar-reuniao.js';
import { situacaoAtividadeContrato, situacaoAtividadeBanco } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */
/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */

/** Categoria do contrato ↔ nome do tipo de atividade (migration 010). */
export const CATEGORIA_EVENTO = {
  workshop: 'Workshop',
  missao_tecnica: 'Missão técnica',
  palestra: 'Palestra',
  evento_parceiro: 'Evento parceiro',
  calendario_unificado: 'Evento do calendário unificado',
};
export const TIPO_REUNIAO = {
  ordinaria: 'Reunião ordinária',
  extraordinaria: 'Reunião extraordinária',
  diretoria: 'Reunião de diretoria',
  gt: 'Reunião de GT',
};
const inverter = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const CATEGORIA_DO_TIPO = inverter(CATEGORIA_EVENTO);
const TIPO_DO_NOME = inverter(TIPO_REUNIAO);

/** Para onde cada situação pode ir (mesma regra de alterar-status-reuniao.js + encerrar). */
const TRANSICOES = {
  rascunho: ['agendada', 'cancelada'],
  agendada: ['em_andamento', 'cancelada', 'rascunho', 'encerrada'],
  em_andamento: ['agendada', 'cancelada', 'encerrada'],
  cancelada: ['agendada'],
  encerrada: [],
};

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- leitura

const SELECAO = `
  select r.*, t.nome as tipo_nome
    from reuniao r left join tipo_atividade t on t.id = r.tipo_atividade_id`;

/** @param {any} r */
export function eventoDoBanco(r) {
  return {
    id: r.id,
    titulo: r.titulo,
    categoria: CATEGORIA_DO_TIPO[r.tipo_nome] ?? '',
    data: r.data,
    horaInicio: hhmm(r.hora_inicio),
    horaFim: hhmm(r.hora_fim),
    modalidade: r.modalidade,
    local: r.local ?? '',
    endereco: r.endereco ?? '',
    linkTransmissao: r.link ?? '',
    organizacao: r.organizacao_responsavel ?? '',
    origem: r.evento_proprio ? 'proprio' : 'parceiro',
    inscricaoExterna: r.inscricao_url ?? '',
    imagemUrl: r.imagem_url ?? '',
    publicoAlvo: r.publico_alvo ?? '',
    limiteParticipantes: r.limite_participantes ?? null,
    status: situacaoAtividadeContrato(r.status),
    descricao: r.descricao ?? '',
    pauta: r.pauta ?? '',
    encaminhamentos: r.encaminhamentos_texto ?? '',
    exibirCalendario: !!r.exibir_publico,
    contaParticipacao: !!r.conta_participacao,
    versaoRegistro: Number(r.versao_registro),
  };
}

/** @param {any} r */
function reuniaoDoBanco(r) {
  return {
    id: r.id,
    tipo: TIPO_DO_NOME[r.tipo_nome] ?? '',
    numero: r.numero ?? null,
    modalidade: r.modalidade,
    organizador: r.responsavel ?? '',
    publicoAlvo: r.publico_alvo ?? '',
    instituicoesConvocadas: (r.instituicoes_convocadas ?? []).join(', '),
    limiteParticipantes: r.limite_participantes ?? null,
    status: situacaoAtividadeContrato(r.status),
    pauta: r.pauta ?? '',
    ata: r.ata_texto ?? '',
    encaminhamentos: r.encaminhamentos_texto ?? '',
    contaParticipacao: !!r.conta_participacao,
    horaInicio: hhmm(r.hora_inicio),
    horaFim: hhmm(r.hora_fim),
    endereco: r.endereco ?? '',
    versaoRegistro: Number(r.versao_registro),
  };
}

/**
 * @param {Transacao} tx
 * @param {string} id
 * @param {'reuniao'|'evento'} natureza
 */
async function lerAtividade(tx, id, natureza) {
  const r = await tx.consultaUm(`${SELECAO} where r.id = $1`, [id]);
  if (!r || r.natureza !== natureza) {
    throw new ErroDeNegocio('NAO_ENCONTRADO', natureza === 'evento' ? 'Evento não encontrado.' : 'Reunião não encontrada.');
  }
  return r;
}

// --------------------------------------------------------------- validação

const texto = (max) => z.union([z.string(), z.null()]).optional()
  .transform((v) => (v === undefined ? undefined : (String(v ?? '').trim() || null)))
  .refine((v) => v === undefined || v === null || v.length <= max, `Máximo de ${max} caracteres.`);
const url = z.union([z.string(), z.null()]).optional()
  .transform((v) => (v === undefined ? undefined : (String(v ?? '').trim() || null)))
  .refine((v) => v === undefined || v === null || /^https?:\/\/\S+$/i.test(v), 'Informe o endereço completo, começando com https://');
const inteiro = z.union([z.number(), z.string(), z.null()]).optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : Number(v)))
  .refine((v) => v === undefined || v === null || (Number.isInteger(v) && v > 0), 'Use um número inteiro maior que zero.');
const bool = z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional()
  .transform((v) => (v === undefined ? undefined : v === true || v === 'true'));
const hora = z.union([z.string(), z.null()]).optional()
  .transform((v) => (v === undefined ? undefined : (String(v ?? '').trim() || null)))
  .refine((v) => v === undefined || v === null || HORA.test(v), 'Horário inválido (HH:mm).');
const situacao = z.enum(['rascunho', 'publicada', 'em_andamento', 'encerrada', 'cancelada'], {
  errorMap: () => ({ message: 'Situação inválida.' }),
}).optional();
const modalidade = z.enum(['presencial', 'online', 'hibrida'], {
  errorMap: () => ({ message: 'Modalidade: presencial, online ou híbrida.' }),
}).optional();

const esquemaEvento = z.object({
  titulo: texto(200),
  categoria: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(CATEGORIA_EVENTO)), {
    errorMap: () => ({ message: 'Selecione a categoria.' }),
  }).optional(),
  data: z.string().regex(DATA, 'Data inválida.').optional(),
  horaInicio: hora,
  horaFim: hora,
  modalidade,
  local: texto(200),
  endereco: texto(300),
  linkTransmissao: url,
  organizacao: texto(200),
  origem: z.enum(['proprio', 'parceiro']).optional(),
  inscricaoExterna: url,
  imagemUrl: url,
  publicoAlvo: texto(500),
  limiteParticipantes: inteiro,
  status: situacao,
  descricao: texto(5000),
  pauta: texto(10000),
  encaminhamentos: texto(10000),
  exibirCalendario: bool,
  contaParticipacao: bool,
  versaoRegistro: z.coerce.number().int().positive().optional(),
});

const esquemaReuniao = z.object({
  tipo: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(TIPO_REUNIAO)), {
    errorMap: () => ({ message: 'Tipo: ordinária, extraordinária, diretoria ou GT.' }),
  }).optional(),
  numero: inteiro,
  modalidade,
  organizador: texto(200),
  publicoAlvo: texto(500),
  instituicoesConvocadas: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  limiteParticipantes: inteiro,
  status: situacao,
  pauta: texto(10000),
  ata: texto(50000),
  encaminhamentos: texto(10000),
  contaParticipacao: bool,
  horaInicio: hora,
  horaFim: hora,
  endereco: texto(300),
  versaoRegistro: z.coerce.number().int().positive().optional(),
});

/** @param {unknown} enviada @param {unknown} atual */
function conferirVersao(enviada, atual) {
  if (enviada && Number(enviada) !== Number(atual)) {
    throw new ErroDeNegocio('VERSAO_DESATUALIZADA',
      'Este registro foi alterado por outra pessoa depois que você abriu a tela. Atualize e refaça.',
      { versaoAtual: Number(atual) });
  }
}

/**
 * @param {Transacao} tx
 * @param {string} nome
 * @param {'reuniao'|'evento'} natureza
 */
async function tipoPorNome(tx, nome, natureza) {
  const t = await tx.consultaUm(
    'select id, conta_participacao_padrao from tipo_atividade where nome = $1 and natureza = $2::natureza_atividade',
    [nome, natureza]);
  if (!t) throw new ErroDeNegocio('NAO_ENCONTRADO', `Tipo "${nome}" não cadastrado.`);
  return t;
}

/**
 * Grava as colunas e devolve a situação pedida (aplicada depois, pelas regras
 * de situação).
 *
 * @param {Transacao} tx
 * @param {string|null} id  null = criar
 * @param {Record<string, unknown>} col
 * @param {Usuario} u
 */
async function gravar(tx, id, col, u) {
  const nomes = Object.keys(col);
  const casts = { status: '::status_reuniao', modalidade: '::modalidade_atividade', natureza: '::natureza_atividade' };
  try {
    if (!id) {
      const l = await tx.consultaUm(
        `insert into reuniao (${nomes.join(', ')}, created_by)
         values (${nomes.map((k, n) => `$${n + 1}${casts[k] ?? ''}`).join(', ')}, $${nomes.length + 1})
         returning id`, [...Object.values(col), u.id]);
      if (!l) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não cria atividades.');
      return l.id;
    }
    if (nomes.length) {
      const l = await tx.consultaUm(
        `update reuniao set ${nomes.map((k, n) => `${k} = $${n + 2}${casts[k] ?? ''}`).join(', ')}
          where id = $1 returning id`, [id, ...Object.values(col)]);
      if (!l) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não altera esta atividade.');
    }
    return id;
  } catch (e) {
    if (e instanceof ErroDeNegocio) throw e;
    return traduzirErroDoBanco(e);
  }
}

/**
 * Muda a situação seguindo as transições; "encerrada" passa pelo caso de uso
 * que lança as ausências (depois do commit das outras alterações).
 *
 * @param {Transacao} tx
 * @param {any} atual
 * @param {string|undefined} pedida  do contrato
 * @returns {Promise<boolean>} true = encerrar depois
 */
async function mudarSituacao(tx, atual, pedida) {
  if (!pedida) return false;
  const nova = situacaoAtividadeBanco(pedida);
  if (nova === atual.status) return false;
  if (!(TRANSICOES[atual.status] ?? []).includes(nova)) {
    throw new ErroDeNegocio('TRANSICAO_INVALIDA',
      atual.status === 'encerrada'
        ? 'Atividade encerrada não muda de situação: presenças e ausências já foram registradas.'
        : `Não é possível ir de "${situacaoAtividadeContrato(atual.status)}" para "${pedida}".`);
  }
  if (nova === 'encerrada') return true;
  await tx.consulta('update reuniao set status = $2::status_reuniao where id = $1', [atual.id, nova]);
  return false;
}

// ------------------------------------------------------------------ eventos

/** @param {Usuario|null} usuario */
export async function listarEventos(usuario) {
  const u = exigir(usuario, 'evento', 'ver');
  return comUsuario(u.id, async (tx) => ({
    dados: (await tx.consulta(`${SELECAO} where r.natureza = 'evento' order by r.data desc, r.hora_inicio nulls last`))
      .map(eventoDoBanco),
  }));
}

/** @param {Usuario|null} usuario */
export function configuracaoEventos(usuario) {
  exigir(usuario, 'evento', 'criar');
  return {
    categorias: Object.keys(CATEGORIA_EVENTO),
    modalidades: ['presencial', 'online', 'hibrida'],
    situacoes: ['rascunho', 'publicada', 'em_andamento', 'encerrada', 'cancelada'],
  };
}

/** @param {Usuario|null} usuario @param {string} id */
export async function obterEvento(usuario, id) {
  const u = exigir(usuario, 'evento', 'ver');
  return comUsuario(u.id, async (tx) => ({ evento: eventoDoBanco(await lerAtividade(tx, id, 'evento')) }));
}

/**
 * @param {Usuario|null} usuario
 * @param {string|null} id  null = criar
 * @param {unknown} corpo
 */
export async function salvarEvento(usuario, id, corpo) {
  const u = exigir(usuario, 'evento', id ? 'editar' : 'criar');
  const d = validar(esquemaEvento, corpo ?? {});

  const encerrar = await comUsuario(u.id, async (tx) => {
    const atual = id ? await lerAtividade(tx, id, 'evento') : null;
    if (atual) conferirVersao(d.versaoRegistro, atual.versao_registro);

    /** @type {{ campo: string, mensagem: string }[]} */
    const erros = [];
    const final = (k, col) => (d[k] !== undefined ? d[k] : atual?.[col] ?? null);
    if (!final('titulo', 'titulo')) erros.push({ campo: 'titulo', mensagem: 'Informe o título.' });
    if (!final('data', 'data')) erros.push({ campo: 'data', mensagem: 'Informe a data.' });
    if (!id && !d.categoria) erros.push({ campo: 'categoria', mensagem: 'Selecione a categoria.' });
    if (!final('organizacao', 'organizacao_responsavel')) erros.push({ campo: 'organizacao', mensagem: 'Informe a organização responsável.' });
    const ini = final('horaInicio', 'hora_inicio');
    const fim = final('horaFim', 'hora_fim');
    if (!ini) erros.push({ campo: 'horaInicio', mensagem: 'Informe o horário inicial.' });
    if (ini && fim && hhmm(fim) <= hhmm(ini)) erros.push({ campo: 'horaFim', mensagem: 'O horário final deve ser posterior ao inicial.' });
    if (erros.length) throw new ErroDeNegocio('DADOS_INVALIDOS', erros[0].mensagem, { campos: erros });

    /** @type {Record<string, unknown>} */
    const col = {};
    const mapa = {
      titulo: 'titulo', data: 'data', horaInicio: 'hora_inicio', horaFim: 'hora_fim', modalidade: 'modalidade',
      local: 'local', endereco: 'endereco', linkTransmissao: 'link', organizacao: 'organizacao_responsavel',
      inscricaoExterna: 'inscricao_url', imagemUrl: 'imagem_url', publicoAlvo: 'publico_alvo',
      limiteParticipantes: 'limite_participantes', descricao: 'descricao', pauta: 'pauta',
      encaminhamentos: 'encaminhamentos_texto', exibirCalendario: 'exibir_publico', contaParticipacao: 'conta_participacao',
    };
    for (const [k, c] of Object.entries(mapa)) if (d[k] !== undefined) col[c] = d[k];
    if (col.modalidade === null) delete col.modalidade;
    if (d.origem) col.evento_proprio = d.origem === 'proprio';
    if (d.categoria) {
      const t = await tipoPorNome(tx, CATEGORIA_EVENTO[d.categoria], 'evento');
      col.tipo_atividade_id = t.id;
      if (!id && d.contaParticipacao === undefined) col.conta_participacao = t.conta_participacao_padrao;
    }
    if (!id) {
      col.natureza = 'evento';
      // Nasce rascunho ou publicada; o resto da vida passa pelas transições.
      const s = situacaoAtividadeBanco(d.status ?? 'rascunho');
      if (!['rascunho', 'agendada'].includes(s)) {
        throw new ErroDeNegocio('TRANSICAO_INVALIDA', 'Evento novo nasce como rascunho ou publicado.');
      }
      col.status = s;
      if (col.conta_participacao === undefined) col.conta_participacao = false;
    }

    const novoId = await gravar(tx, id, col, u);
    const fechar = atual ? await mudarSituacao(tx, { ...atual, id: novoId }, d.status) : false;
    return { id: novoId, fechar };
  });

  if (encerrar.fechar) await encerrarReuniao(u, encerrar.id);
  return obterEvento(u, encerrar.id);
}

// ------------------------------------------------------------------ reunião

/** @param {Usuario|null} usuario @param {string} id */
export async function obterGovernancaReuniao(usuario, id) {
  const u = exigir(usuario, 'reuniao', 'ver');
  return comUsuario(u.id, async (tx) => reuniaoDoBanco(await lerAtividade(tx, id, 'reuniao')));
}

/** @param {Usuario|null} usuario @param {string} id @param {unknown} corpo */
export async function salvarGovernancaReuniao(usuario, id, corpo) {
  const u = exigir(usuario, 'reuniao', 'editar');
  const d = validar(esquemaReuniao, corpo ?? {});

  const r = await comUsuario(u.id, async (tx) => {
    const atual = await lerAtividade(tx, id, 'reuniao');
    conferirVersao(d.versaoRegistro, atual.versao_registro);

    /** @type {Record<string, unknown>} */
    const col = {};
    const mapa = {
      numero: 'numero', modalidade: 'modalidade', organizador: 'responsavel', publicoAlvo: 'publico_alvo',
      limiteParticipantes: 'limite_participantes', pauta: 'pauta', ata: 'ata_texto',
      encaminhamentos: 'encaminhamentos_texto', contaParticipacao: 'conta_participacao',
      horaInicio: 'hora_inicio', horaFim: 'hora_fim', endereco: 'endereco',
    };
    for (const [k, c] of Object.entries(mapa)) if (d[k] !== undefined) col[c] = d[k];
    if (col.modalidade === null) delete col.modalidade;
    const ini = col.hora_inicio !== undefined ? col.hora_inicio : atual.hora_inicio;
    const fim = col.hora_fim !== undefined ? col.hora_fim : atual.hora_fim;
    if (ini && fim && hhmm(fim) <= hhmm(ini)) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', 'O horário final deve ser posterior ao inicial.',
        { campos: [{ campo: 'horaFim', mensagem: 'Posterior ao início.' }] });
    }
    if (d.tipo) col.tipo_atividade_id = (await tipoPorNome(tx, TIPO_REUNIAO[d.tipo], 'reuniao')).id;

    if (d.instituicoesConvocadas !== undefined) {
      const lista = (Array.isArray(d.instituicoesConvocadas) ? d.instituicoesConvocadas
        : String(d.instituicoesConvocadas ?? '').split(/[\s,;]+/)).map((x) => x.trim()).filter(Boolean);
      const unicos = [...new Set(lista)];
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const invalidos = unicos.filter((x) => !UUID.test(x));
      const existentes = invalidos.length ? [] : await tx.consulta(
        'select id from instituicao where id = any($1::uuid[])', [unicos]);
      if (invalidos.length || existentes.length !== unicos.length) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', 'Há instituição convocada que não existe no cadastro.',
          { campos: [{ campo: 'instituicoesConvocadas', mensagem: 'Confira os identificadores.' }] });
      }
      col.instituicoes_convocadas = unicos;
    }

    await gravar(tx, id, col, u);
    return { fechar: await mudarSituacao(tx, atual, d.status) };
  });

  if (r.fechar) await encerrarReuniao(u, id);
  return obterGovernancaReuniao(u, id);
}
