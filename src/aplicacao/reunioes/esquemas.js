/**
 * Esquemas de entrada das reuniões.
 *
 * A tela ainda não veio do UX/UI: os campos saem do que o banco já modela
 * (migration 001 + `endereco` da 002) e do que o dashboard exibe.
 */
import { z } from 'zod';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const opcional = (max = 200) =>
  z.string().trim().max(max).optional().transform((v) => (v || null));

/** Aceita "2026-09-12T13:00:00Z" e também "2026-09-12 13:00". */
const instante = z.string().trim().min(10).optional().nullable()
  .transform((v) => (v ? new Date(v.replace(' ', 'T')) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), 'Data e hora inválidas.')
  .transform((d) => (d ? d.toISOString() : null));

/**
 * O objeto base, sem os refines.
 * `.refine()` embrulha o esquema num ZodEffects, que não tem `.partial()`.
 * Nomear a base evita depender de `innerType()`, que quebra ao entrar um
 * segundo refine.
 */
const objetoReuniao = z.object({
  titulo: z.string().trim().min(3, 'Informe o título da reunião.').max(200),
  descricao: opcional(1000),
  pauta: z.string().trim().max(5000).optional().transform((v) => (v || null)),

  data: z.string().regex(DATA, 'Informe a data da reunião (AAAA-MM-DD).'),
  horaInicio: z.string().regex(HORA, 'Horário inválido. Use HH:MM.').optional()
    .or(z.literal('')).transform((v) => (v || null)),
  horaFim: z.string().regex(HORA, 'Horário inválido. Use HH:MM.').optional()
    .or(z.literal('')).transform((v) => (v || null)),

  // local é a sala ("Auditório"); endereco é o prédio ("Prefeitura de
  // Guarapuava"). É o que o dashboard mostra em duas linhas.
  local: opcional(200),
  endereco: opcional(300),

  // Reunião on-line. A senha é a da sala (Meet/Zoom), não credencial de acesso
  // ao sistema — por isso viaja como texto comum.
  link: z.string().trim().url('Informe um link válido, começando com https://')
    .max(500).optional().or(z.literal('')).transform((v) => (v || null)),
  senhaAcesso: opcional(100),

  // Janela do QR Code. Sem ela vale o dia inteiro da reunião — assim uma
  // reunião cadastrada às pressas não fica com o check-in travado.
  checkinAbreEm: instante,
  checkinFechaEm: instante,

  // Atalho da tela de criação: já convida todos os vínculos ativos de
  // instituições ativas. Com 122 instituições, convidar na mão não é opção.
  convidarTodos: z.coerce.boolean().optional().default(false),

  // ------------------------------------------- revisão de outubro (migration 010)
  // Rascunho = montada pela Diretoria, ainda não divulgada; agendada = publicada.
  status: z.enum(['rascunho', 'agendada']).optional(),
  tipoAtividadeId: z.coerce.number().int().positive('Selecione o tipo.').optional().nullable(),
  // "68ª Reunião Ordinária"
  numero: z.coerce.number().int().positive('O número precisa ser maior que zero.')
    .optional().nullable(),
  modalidade: z.enum(['presencial', 'online', 'hibrida'], {
    errorMap: () => ({ message: 'Modalidade: presencial, online ou hibrida.' }),
  }).optional(),
  responsavel: opcional(200),
  publicoAlvo: opcional(500),
  limiteParticipantes: z.coerce.number().int().positive('O limite precisa ser maior que zero.')
    .optional().nullable(),
  // Se entra no percentual OFICIAL de participação. Sem informar, vale o padrão
  // do tipo (ordinária e extraordinária contam; evento não).
  contaParticipacao: z.boolean().optional(),
  permiteConvidado: z.boolean().optional(),
  exibirPublico: z.boolean().optional(),
  grupoTrabalhoId: z.coerce.number().int().positive().optional().nullable(),
  // Só de evento
  organizacaoResponsavel: opcional(200),
  eventoProprio: z.boolean().optional(),
  inscricaoUrl: z.string().trim().url('Informe o link de inscrição completo, com https://')
    .max(500).optional().or(z.literal('')).transform((v) => (v || null)),
  totalParticipantesExterno: z.coerce.number().int().min(0).optional().nullable(),
});

/**
 * As duas coerências de horário, na criação e na edição. Num PATCH, o campo que
 * falta é ignorado; a comparação com o que está gravado fica no caso de uso.
 *
 * @template {import('zod').ZodTypeAny} T
 * @param {T} esquema
 */
const comCoerenciaDeHorario = (esquema) => esquema
  .refine((/** @type {any} */ d) => !d.horaFim || !d.horaInicio || d.horaFim > d.horaInicio, {
    message: 'O horário de término tem que ser depois do início.',
    path: ['horaFim'],
  })
  .refine((/** @type {any} */ d) => !d.checkinFechaEm || !d.checkinAbreEm
    || d.checkinFechaEm > d.checkinAbreEm, {
    message: 'O fechamento do check-in tem que ser depois da abertura.',
    path: ['checkinFechaEm'],
  });

export const esquemaCriarReuniao = comCoerenciaDeHorario(objetoReuniao);
export const esquemaEditarReuniao = comCoerenciaDeHorario(objetoReuniao.partial());

export const esquemaStatusReuniao = z.object({
  status: z.enum(['rascunho', 'agendada', 'em_andamento', 'cancelada'], {
    errorMap: () => ({ message: 'Situação inválida.' }),
  }),
  motivo: z.string().trim().max(300).optional().nullable(),
});

export const esquemaFiltroReuniao = z.object({
  busca: z.string().trim().max(120).optional(),
  status: z.enum(['rascunho', 'agendada', 'em_andamento', 'encerrada', 'cancelada']).optional(),
  tipoAtividadeId: z.coerce.number().int().positive().optional(),
  grupoTrabalhoId: z.coerce.number().int().positive().optional(),
  modalidade: z.enum(['presencial', 'online', 'hibrida']).optional(),
  // Atalhos que a tela de lista usa nas abas.
  periodo: z.enum(['proximas', 'passadas', 'todas']).default('todas'),
  de: z.string().regex(DATA).optional(),
  ate: z.string().regex(DATA).optional(),
  instituicaoId: z.string().uuid().optional(),
  ordem: z.enum(['asc', 'desc']).default('desc'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

/** Rótulos para as telas. */
export const ROTULO_NATUREZA = { reuniao: 'Reunião', evento: 'Evento' };

/**
 * camelCase da tela → colunas do banco. Mesmo papel do paraColunas() das
 * instituições: a tradução mora num lugar só.
 *
 * @param {Record<string, any>} d
 * @returns {Record<string, any>}
 */
export function paraColunasReuniao(d) {
  /** @type {Record<string, [string, any]>} */
  const mapa = {
    titulo: ['titulo', d.titulo],
    descricao: ['descricao', d.descricao],
    pauta: ['pauta', d.pauta],
    data: ['data', d.data],
    horaInicio: ['hora_inicio', d.horaInicio],
    horaFim: ['hora_fim', d.horaFim],
    local: ['local', d.local],
    endereco: ['endereco', d.endereco],
    link: ['link', d.link],
    senhaAcesso: ['senha_acesso', d.senhaAcesso],
    checkinAbreEm: ['checkin_abre_em', d.checkinAbreEm],
    checkinFechaEm: ['checkin_fecha_em', d.checkinFechaEm],
    status: ['status', d.status],
    tipoAtividadeId: ['tipo_atividade_id', d.tipoAtividadeId],
    numero: ['numero', d.numero],
    modalidade: ['modalidade', d.modalidade],
    responsavel: ['responsavel', d.responsavel],
    publicoAlvo: ['publico_alvo', d.publicoAlvo],
    limiteParticipantes: ['limite_participantes', d.limiteParticipantes],
    contaParticipacao: ['conta_participacao', d.contaParticipacao],
    permiteConvidado: ['permite_convidado', d.permiteConvidado],
    exibirPublico: ['exibir_publico', d.exibirPublico],
    grupoTrabalhoId: ['grupo_trabalho_id', d.grupoTrabalhoId],
    organizacaoResponsavel: ['organizacao_responsavel', d.organizacaoResponsavel],
    eventoProprio: ['evento_proprio', d.eventoProprio],
    inscricaoUrl: ['inscricao_url', d.inscricaoUrl],
    totalParticipantesExterno: ['total_participantes_externo', d.totalParticipantesExterno],
  };

  /** @type {Record<string, any>} */
  const colunas = {};
  for (const [chave, [coluna, valor]] of Object.entries(mapa)) {
    if (chave in d && d[chave] !== undefined) colunas[coluna] = valor ?? null;
  }
  // Colunas NOT NULL com padrão no banco: null explícito não apaga, ignora.
  for (const c of ['modalidade', 'conta_participacao', 'permite_convidado',
    'exibir_publico', 'evento_proprio', 'status']) {
    if (c in colunas && colunas[c] === null) delete colunas[c];
  }
  return colunas;
}
