/**
 * Esquemas das solicitações de alteração (revisão de outubro).
 *
 * Cada tipo tem o seu formato de `dados`. Validar na ENTRADA, e não só na
 * aprovação, é o que impede a Diretoria de abrir um pedido e descobrir na hora
 * de aprovar que ele não tinha como ser aplicado.
 */
import { z } from 'zod';
import { apenasDigitos, cnpjValido } from '@/dominio/cnpj.js';
import { cpfValido, apenasDigitos as soDigitosCpf } from '@/dominio/cpf.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const TIPOS_SOLICITACAO = /** @type {const} */ ([
  'alterar_dados', 'troca_titular', 'troca_suplente', 'incluir_representante',
  'remover_representante', 'novo_oficio', 'entrada_forum', 'saida_forum',
  'correcao_presenca',
]);

export const ROTULO_SOLICITACAO = {
  alterar_dados: 'Alteração de dados cadastrais',
  troca_titular: 'Troca de titular',
  troca_suplente: 'Troca de suplente',
  incluir_representante: 'Inclusão de representante',
  remover_representante: 'Exclusão de representante',
  novo_oficio: 'Novo ofício',
  entrada_forum: 'Entrada no Fórum',
  saida_forum: 'Saída do Fórum',
  correcao_presenca: 'Correção de presença',
};

/** Os campos sensíveis da instituição que mudam por solicitação. */
const camposSensiveis = z.object({
  nome: z.string().trim().min(3, 'Informe o nome da instituição.').max(200),
  razaoSocial: z.string().trim().max(200),
  nomeFantasia: z.string().trim().max(200),
  cnpj: z.string().transform(apenasDigitos)
    .refine(cnpjValido, 'CNPJ inválido. Confira os números digitados.'),
  dataFundacao: z.string().regex(DATA, 'Data de fundação inválida (AAAA-MM-DD).'),
  tipoInstituicaoId: z.coerce.number().int().positive(),
  areaAtuacaoId: z.coerce.number().int().positive(),
  vertenteId: z.coerce.number().int().positive().nullable(),
  grupoTrabalhoIds: z.array(z.coerce.number().int().positive()).max(30),
}).partial().strict('Este campo não muda por solicitação (ou não existe).')
  .refine((o) => Object.keys(o).length > 0, 'Informe ao menos um campo a alterar.');

/** Quem assume: uma pessoa já cadastrada OU os dados de uma nova. */
const pessoaNova = z.object({
  nome: z.string().trim().min(3, 'Informe o nome completo.').max(200),
  cpf: z.string().trim().optional().or(z.literal(''))
    .transform((v) => (v ? soDigitosCpf(v) : null))
    .refine((v) => v === null || cpfValido(v), 'CPF inválido.'),
  email: z.string().trim().email('E-mail inválido.').optional().or(z.literal(''))
    .transform((v) => (v ? v.toLowerCase() : null)),
  telefone: z.string().trim().max(20).optional().transform((v) => v || null),
});

const representacao = z.object({
  pessoaId: z.string().uuid().optional(),
  pessoa: pessoaNova.optional(),
  cargo: z.string().trim().max(120).optional().transform((v) => v || null),
  dataInicio: z.string().regex(DATA, 'Data de início inválida (AAAA-MM-DD).').optional(),
  // O que acontece com quem sai da função (só troca de titular/suplente):
  // encerrar o vínculo, ou mantê-lo como integrante.
  anterior: z.enum(['encerrar', 'manter_como_integrante']).optional().default('encerrar'),
  motivo: z.string().trim().max(500).optional().transform((v) => v || null),
}).refine((d) => !!d.pessoaId !== !!d.pessoa, {
  message: 'Indique uma pessoa já cadastrada (pessoaId) OU os dados de uma nova (pessoa).',
  path: ['pessoaId'],
});

/** @type {Record<typeof TIPOS_SOLICITACAO[number], import('zod').ZodTypeAny>} */
export const ESQUEMA_DADOS = {
  alterar_dados: z.object({ campos: camposSensiveis }),
  troca_titular: representacao,
  troca_suplente: representacao,
  incluir_representante: representacao.and(z.object({
    tipoRepresentacao: z.enum(['integrante', 'convidado']).optional().default('integrante'),
  })),
  remover_representante: z.object({
    vinculoId: z.string().uuid('Indique o vínculo a encerrar.'),
    dataFim: z.string().regex(DATA).optional(),
    motivo: z.string().trim().min(3, 'Informe o motivo.').max(500),
  }),
  // O ofício em si vai em documentoId (anexado antes pela rota de documentos).
  novo_oficio: z.object({ descricao: z.string().trim().max(500).optional() }),
  entrada_forum: z.object({ observacoes: z.string().trim().max(500).optional() }),
  saida_forum: z.object({
    dataSaida: z.string().regex(DATA).optional(),
    motivo: z.string().trim().min(3, 'Informe o motivo da saída.').max(500),
  }),
  correcao_presenca: z.object({
    reuniaoId: z.string().uuid('Indique a reunião.'),
    pessoaId: z.string().uuid('Indique o participante.'),
    status: z.enum(['presente', 'ausente', 'justificado']),
    observacoes: z.string().trim().max(500).optional().transform((v) => v || null),
  }),
};

export const esquemaCriarSolicitacao = z.object({
  tipo: z.enum(TIPOS_SOLICITACAO, {
    errorMap: () => ({ message: 'Tipo de solicitação inválido.' }),
  }),
  // A gestão pode abrir em nome de uma instituição; o representante, só da dele
  // (e, se não informar, vale a dele).
  instituicaoId: z.string().uuid().optional(),
  dados: z.record(z.unknown()).optional().default({}),
  justificativa: z.string().trim().max(2000).optional().transform((v) => v || null),
  documentoId: z.string().uuid().optional(),
});

export const esquemaDecisao = z.object({
  decisao: z.enum(['aprovar', 'recusar'], {
    errorMap: () => ({ message: 'Decida "aprovar" ou "recusar".' }),
  }),
  resposta: z.string().trim().max(2000).optional().transform((v) => v || null),
});

export const esquemaFiltroSolicitacao = z.object({
  status: z.enum(['pendente', 'aprovada', 'recusada', 'cancelada']).optional(),
  tipo: z.enum(TIPOS_SOLICITACAO).optional(),
  instituicaoId: z.string().uuid().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});
