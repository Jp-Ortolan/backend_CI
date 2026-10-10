/**
 * Esquemas de entrada do cadastro de instituição.
 *
 * Espelham o formulário Nova instituição campo por campo, inclusive quais são
 * obrigatórios. O front valida para dar retorno rápido; esta camada valida
 * porque é ela que protege o banco — um POST direto na API não passa pela tela.
 *
 * Revisão de outubro: campos do Fórum (razão social, vertente, GTs, redes,
 * contatos, autorizações) e o fluxo novo de situação. Instituição em RASCUNHO
 * só precisa do nome — quem completa é o representante, pela área dele.
 */
import { z } from 'zod';
import { apenasDigitos, cnpjValido } from '@/dominio/cnpj.js';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Situações na ordem do fluxo. Mesma lista do enum status_instituicao. */
export const STATUS_INSTITUICAO = /** @type {const} */ ([
  'rascunho', 'aguardando_documentos', 'em_analise', 'ajustes_solicitados',
  'ativa', 'em_processo_saida', 'inativa', 'desligada',
]);

/** Rótulos para a tela. */
export const ROTULO_STATUS_INSTITUICAO = {
  rascunho: 'Rascunho',
  aguardando_documentos: 'Aguardando documentos',
  em_analise: 'Em análise',
  ajustes_solicitados: 'Ajustes solicitados',
  ativa: 'Aprovada / ativa',
  em_processo_saida: 'Em processo de saída',
  inativa: 'Inativa',
  desligada: 'Desligada',
};

/** Enquanto está nestas situações, a instituição ainda está se cadastrando. */
export const EM_PREENCHIMENTO = ['rascunho', 'aguardando_documentos', 'ajustes_solicitados'];

/**
 * Campos que o representante altera direto, sem aprovação — "Atualizar
 * telefone, e-mail, endereço e redes sociais. Enviar ou substituir a logo."
 * A mesma lista, em nomes de coluna, está na trigger da migration 008.
 */
export const CAMPOS_LIVRES_REPRESENTANTE = [
  'email', 'telefone', 'site',
  'logradouro', 'numero', 'bairro', 'cidade', 'estado', 'cep', 'complemento',
  'descricao', 'redesSociais', 'contatosComunicacao',
  'autorizaDivulgacao', 'autorizaLogo',
];

/** Campos que são decisão da gestão, mesmo durante o preenchimento. */
export const CAMPOS_DA_GESTAO = [
  'status', 'dataEntrada', 'dataSaida', 'observacoes', 'motivoSaida', 'substituidaPorId',
];

/** Texto que vira null quando vem vazio — o banco prefere null a string vazia. */
const opcional = (max = 200) =>
  z.string().trim().max(max).optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

const url = z.string().trim().max(300)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v),
    'Informe o endereço completo, começando com https://')
  .transform((v) => v || undefined);

/** Instagram, LinkedIn... — só endereço http(s), nunca "javascript:". */
export const esquemaRedes = z.object({
  instagram: url.optional(),
  linkedin: url.optional(),
  facebook: url.optional(),
  youtube: url.optional(),
  x: url.optional(),
  outro: url.optional(),
}).strict('Rede social não reconhecida.')
  .transform((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v)));

export const esquemaContato = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do contato.').max(120),
  email: z.string().trim().email('E-mail do contato inválido.').optional()
    .or(z.literal('')).transform((v) => (v ? v.toLowerCase() : null)),
  telefone: z.string().trim().max(20).optional().transform((v) => v || null),
  funcao: z.string().trim().max(120).optional().transform((v) => v || null),
});

/**
 * O objeto base, sem o refine. Separado pelo mesmo motivo do esquema de
 * reunião: `.refine()` embrulha num ZodEffects, que não tem `.partial()`.
 */
const objetoInstituicao = z.object({
  // ------------------------------------------------------ informações básicas
  nome: z.string().trim().min(3, 'Informe o nome da instituição.').max(200),
  razaoSocial: opcional(200),
  nomeFantasia: opcional(200),

  cnpj: z.string()
    .transform(apenasDigitos)
    .refine(cnpjValido, 'CNPJ inválido. Confira os números digitados.'),

  dataFundacao: z.string().regex(DATA, 'Informe a data de fundação (AAAA-MM-DD).'),

  status: z.enum(STATUS_INSTITUICAO, {
    errorMap: () => ({ message: 'Selecione uma situação válida.' }),
  }),

  // A tela não marca o e-mail como obrigatório, então aqui também não é.
  email: z.string().trim().email('E-mail institucional inválido.').optional()
    .or(z.literal('')).transform((v) => (v ? v.toLowerCase() : null)),

  telefone: z.string().trim().min(8, 'Informe o telefone.').max(20),

  site: opcional(200),

  // ---------------------------------------------------------------- endereço
  logradouro: z.string().trim().min(3, 'Informe o logradouro.').max(200),
  numero: opcional(20),
  bairro: z.string().trim().min(2, 'Informe o bairro.').max(100),
  cidade: z.string().trim().min(2, 'Informe a cidade.').max(100),

  estado: z.string().trim().toUpperCase()
    .refine((v) => UFS.includes(v), 'Selecione um estado válido.'),

  cep: z.string().transform(apenasDigitos)
    .refine((v) => v.length === 8, 'CEP inválido. Devem ser 8 dígitos.'),

  complemento: opcional(120),

  // ----------------------------------------------------------- classificação
  tipoInstituicaoId: z.coerce.number().int().positive('Selecione o tipo de instituição.'),
  areaAtuacaoId: z.coerce.number().int().positive('Selecione a área de atuação.'),
  vertenteId: z.coerce.number().int().positive('Selecione a vertente.').optional().nullable(),
  grupoTrabalhoIds: z.array(z.coerce.number().int().positive()).max(30).optional(),

  descricao: z.string().trim().max(500, 'A descrição não pode passar de 500 caracteres.')
    .optional().transform((v) => (v ? v : null)),

  // ------------------------------------------------------------ comunicação
  redesSociais: esquemaRedes.optional(),
  contatosComunicacao: z.array(esquemaContato).max(10, 'No máximo 10 contatos.').optional(),
  autorizaDivulgacao: z.boolean().optional(),
  autorizaLogo: z.boolean().optional(),

  // ------------------------------------- campos que não aparecem no formulário
  // Existem no banco desde a 001 e sustentam o período de participação.
  dataEntrada: z.string().regex(DATA).optional().nullable(),
  dataSaida: z.string().regex(DATA).optional().nullable(),
  observacoes: opcional(2000),
  responsavel: opcional(200),
  motivoSaida: opcional(500),
  substituidaPorId: z.string().uuid().optional().nullable(),
});

// Barrar aqui aponta o campo que falta, em vez de devolver o erro genérico da
// constraint instituicao_inativa_tem_saida.
const exigeSaida = (/** @type {any} */ d) =>
  !['inativa', 'desligada'].includes(d.status) || !!d.dataSaida;

export const esquemaCriar = objetoInstituicao.refine(exigeSaida, {
  message: 'Para cadastrar como inativa ou desligada é preciso informar a data de saída.',
  path: ['dataSaida'],
});

/**
 * Rascunho: a Diretoria abre o cadastro só com o nome e a instituição completa
 * depois, pela área dela. Os campos que vierem continuam sendo validados.
 */
export const esquemaRascunho = objetoInstituicao.partial()
  .required({ nome: true })
  .extend({ status: z.enum(['rascunho', 'aguardando_documentos']).default('rascunho') });

/**
 * Edição: os mesmos campos, todos opcionais — a tela manda o formulário inteiro,
 * mas um PATCH parcial também tem que funcionar.
 * Sem refine de propósito: quem confere status contra a data de saída já gravada
 * é editar-instituicao.js, que enxerga a linha atual.
 */
export const esquemaEditar = objetoInstituicao.partial();

export const esquemaStatus = z.object({
  status: z.enum(STATUS_INSTITUICAO, {
    errorMap: () => ({ message: 'Situação inválida.' }),
  }),
  dataSaida: z.string().regex(DATA).optional().nullable(),
  dataEntrada: z.string().regex(DATA).optional().nullable(),
  motivo: z.string().trim().max(500).optional().nullable(),
  substituidaPorId: z.string().uuid().optional().nullable(),
});

export const esquemaFiltro = z.object({
  busca: z.string().trim().max(120).optional(),
  status: z.enum(STATUS_INSTITUICAO).optional(),
  tipoInstituicaoId: z.coerce.number().int().positive().optional(),
  areaAtuacaoId: z.coerce.number().int().positive().optional(),
  vertenteId: z.coerce.number().int().positive().optional(),
  grupoTrabalhoId: z.coerce.number().int().positive().optional(),
  cidade: z.string().trim().max(100).optional(),
  uf: z.string().trim().length(2).toUpperCase().optional(),
  ordenarPor: z.enum(['nome', 'cidade', 'status', 'criado']).default('nome'),
  ordem: z.enum(['asc', 'desc']).default('asc'),
  pagina: z.coerce.number().int().min(1).default(1),
  // Teto de 100: sem ele, "?porPagina=99999" vira um jeito fácil de baixar a
  // base inteira numa requisição.
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Converte a entrada validada (camelCase da tela) para as colunas do banco
 * (snake_case). Um lugar só, para não haver `dataFundacao` num arquivo e
 * `data_fundacao` em outro.
 *
 * `grupoTrabalhoIds` não é coluna (é tabela de ligação) e fica de fora: quem
 * grava é gravarGruposDaInstituicao().
 *
 * @param {Record<string, any>} d
 * @returns {Record<string, any>}
 */
export function paraColunas(d) {
  /** @type {Record<string, [string, any]>} */
  const mapa = {
    nome: ['nome', d.nome],
    razaoSocial: ['razao_social', d.razaoSocial],
    nomeFantasia: ['nome_fantasia', d.nomeFantasia],
    cnpj: ['cnpj', d.cnpj],
    dataFundacao: ['data_fundacao', d.dataFundacao],
    status: ['status', d.status],
    email: ['email', d.email],
    telefone: ['telefone', d.telefone],
    site: ['site', d.site],
    logradouro: ['logradouro', d.logradouro],
    numero: ['numero', d.numero],
    bairro: ['bairro', d.bairro],
    cidade: ['cidade', d.cidade],
    estado: ['uf', d.estado],
    cep: ['cep', d.cep],
    complemento: ['complemento', d.complemento],
    tipoInstituicaoId: ['tipo_instituicao_id', d.tipoInstituicaoId],
    areaAtuacaoId: ['area_atuacao_id', d.areaAtuacaoId],
    vertenteId: ['vertente_id', d.vertenteId],
    descricao: ['descricao', d.descricao],
    redesSociais: ['redes_sociais', d.redesSociais ? JSON.stringify(d.redesSociais) : '{}'],
    contatosComunicacao: ['contatos_comunicacao',
      d.contatosComunicacao ? JSON.stringify(d.contatosComunicacao) : '[]'],
    autorizaDivulgacao: ['autoriza_divulgacao', d.autorizaDivulgacao],
    autorizaLogo: ['autoriza_logo', d.autorizaLogo],
    dataEntrada: ['data_entrada', d.dataEntrada],
    dataSaida: ['data_saida', d.dataSaida],
    observacoes: ['observacoes', d.observacoes],
    responsavel: ['responsavel', d.responsavel],
    motivoSaida: ['motivo_saida', d.motivoSaida],
    substituidaPorId: ['substituida_por_id', d.substituidaPorId],
  };

  /** @type {Record<string, any>} */
  const colunas = {};
  for (const [chave, [coluna, valor]] of Object.entries(mapa)) {
    if (chave in d && d[chave] !== undefined) colunas[coluna] = valor ?? null;
  }
  // Colunas NOT NULL com default no banco: null explícito vira o default.
  for (const c of ['autoriza_divulgacao', 'autoriza_logo']) {
    if (c in colunas && colunas[c] === null) delete colunas[c];
  }
  return colunas;
}

/**
 * Regrava os GTs da instituição (substitui a lista inteira).
 *
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {string} instituicaoId
 * @param {number[]} ids
 */
export async function gravarGruposDaInstituicao(tx, instituicaoId, ids) {
  await tx.consulta(
    'delete from instituicao_grupo_trabalho where instituicao_id = $1', [instituicaoId]);
  if (ids.length) {
    await tx.consulta(
      `insert into instituicao_grupo_trabalho (instituicao_id, grupo_trabalho_id)
       select $1, unnest($2::smallint[])
       on conflict do nothing`,
      [instituicaoId, ids],
    );
  }
}
