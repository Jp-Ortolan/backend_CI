/**
 * Esquemas de entrada do cadastro de instituição.
 *
 * Espelham o formulário Nova instituição campo por campo, inclusive quais são
 * obrigatórios. O front valida para dar retorno rápido; esta camada valida
 * porque é ela que protege o banco — um POST direto na API não passa pela tela.
 */
import { z } from 'zod';
import { apenasDigitos, cnpjValido } from '@/dominio/cnpj.js';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Texto que vira null quando vem vazio — o banco prefere null a string vazia. */
const opcional = (max = 200) =>
  z.string().trim().max(max).optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

/**
 * O objeto base, sem o refine. Separado pelo mesmo motivo do esquema de
 * reunião: `.refine()` embrulha num ZodEffects, que não tem `.partial()`.
 */
const objetoInstituicao = z.object({
  // ------------------------------------------------------ informações básicas
  nome: z.string().trim().min(3, 'Informe o nome da instituição.').max(200),

  cnpj: z.string()
    .transform(apenasDigitos)
    .refine(cnpjValido, 'CNPJ inválido. Confira os números digitados.'),

  dataFundacao: z.string().regex(DATA, 'Informe a data de fundação (AAAA-MM-DD).'),

  status: z.enum(['em_processo_entrada', 'ativa', 'em_processo_saida', 'inativa'], {
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

  descricao: z.string().trim().max(500, 'A descrição não pode passar de 500 caracteres.')
    .optional().transform((v) => (v ? v : null)),

  // ------------------------------------- campos que não aparecem no formulário
  // Existem no banco desde a 001 e sustentam o período de participação.
  dataEntrada: z.string().regex(DATA).optional().nullable(),
  dataSaida: z.string().regex(DATA).optional().nullable(),
  observacoes: opcional(2000),
  responsavel: opcional(200),
});

// Barrar aqui aponta o campo que falta, em vez de devolver o erro genérico da
// constraint instituicao_inativa_tem_saida.
export const esquemaCriar = objetoInstituicao.refine(
  (d) => d.status !== 'inativa' || !!d.dataSaida, {
    message: 'Para cadastrar como inativa é preciso informar a data de saída.',
    path: ['dataSaida'],
  });

/**
 * Edição: os mesmos campos, todos opcionais — a tela manda o formulário inteiro,
 * mas um PATCH parcial também tem que funcionar.
 * Sem refine de propósito: quem confere status contra a data de saída já gravada
 * é editar-instituicao.js, que enxerga a linha atual.
 */
export const esquemaEditar = objetoInstituicao.partial();

export const esquemaStatus = z.object({
  status: z.enum(['em_processo_entrada', 'ativa', 'em_processo_saida', 'inativa']),
  dataSaida: z.string().regex(DATA).optional().nullable(),
  motivo: z.string().trim().max(300).optional().nullable(),
});

export const esquemaFiltro = z.object({
  busca: z.string().trim().max(120).optional(),
  status: z.enum(['em_processo_entrada', 'ativa', 'em_processo_saida', 'inativa']).optional(),
  tipoInstituicaoId: z.coerce.number().int().positive().optional(),
  areaAtuacaoId: z.coerce.number().int().positive().optional(),
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
 * @param {Record<string, any>} d
 * @returns {Record<string, any>}
 */
export function paraColunas(d) {
  /** @type {Record<string, [string, any]>} */
  const mapa = {
    nome: ['nome', d.nome],
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
    descricao: ['descricao', d.descricao],
    dataEntrada: ['data_entrada', d.dataEntrada],
    dataSaida: ['data_saida', d.dataSaida],
    observacoes: ['observacoes', d.observacoes],
    responsavel: ['responsavel', d.responsavel],
  };

  /** @type {Record<string, any>} */
  const colunas = {};
  for (const [chave, [coluna, valor]] of Object.entries(mapa)) {
    if (chave in d) colunas[coluna] = valor ?? null;
  }
  return colunas;
}
