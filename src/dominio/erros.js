/**
 * Erros de negócio com código estável.
 *
 * O `codigo` é contrato com o front-end e não muda sem combinar.
 * A `mensagem` é texto em português e pode ser reescrita à vontade.
 *
 * Ver docs/04-contrato-de-api.md
 */

/**
 * @typedef {'REUNIAO_NAO_ENCONTRADA'|'REUNIAO_CANCELADA'|'CHECKIN_FECHADO'
 *   |'PRESENCA_JA_REGISTRADA'|'VINCULO_INVALIDO'|'VINCULO_JA_ENCERRADO'
 *   |'DATA_FIM_ANTERIOR_AO_INICIO'|'DADOS_INVALIDOS'|'MUITAS_TENTATIVAS'
 *   |'NAO_AUTENTICADO'|'SEM_PERMISSAO'|'ERRO_INTERNO'
 *   |'NAO_ENCONTRADO'|'CNPJ_DUPLICADO'|'EMAIL_DUPLICADO'|'VINCULO_DUPLICADO'
 *   |'INSTITUICAO_COM_HISTORICO'|'INSTITUICAO_COM_VINCULO'
 *   |'REUNIAO_COM_PRESENCA'|'REUNIAO_COM_DOCUMENTO'|'CONVITE_DUPLICADO'
 *   |'INSTITUICAO_COM_DOCUMENTO'|'ARQUIVO_GRANDE_DEMAIS'|'TIPO_NAO_PERMITIDO'
 *   |'DOCUMENTO_E_LINK'
 *   |'DATA_SAIDA_OBRIGATORIA'} CodigoErro
 */

/** @type {Record<CodigoErro, number>} */
const HTTP = {
  REUNIAO_NAO_ENCONTRADA:      404,
  REUNIAO_CANCELADA:           410,
  CHECKIN_FECHADO:             403,
  PRESENCA_JA_REGISTRADA:      409,
  VINCULO_INVALIDO:            422,
  VINCULO_JA_ENCERRADO:        409,
  DATA_FIM_ANTERIOR_AO_INICIO: 422,
  DADOS_INVALIDOS:             422,
  MUITAS_TENTATIVAS:           429,
  NAO_AUTENTICADO:             401,
  SEM_PERMISSAO:               403,
  ERRO_INTERNO:                500,

  // ------------------------------------------------- Sprint 1 (27/08 a 02/09)
  NAO_ENCONTRADO:              404,
  CNPJ_DUPLICADO:              409,
  EMAIL_DUPLICADO:             409,
  VINCULO_DUPLICADO:           409,

// 409 e não 403: a ação é permitida, o estado do registro é que impede.
  INSTITUICAO_COM_HISTORICO:   409,
  INSTITUICAO_COM_VINCULO:     409,

  DATA_SAIDA_OBRIGATORIA:      422,

// Mesma ideia: excluir é permitido, o histórico é que impede (migration 003).
  REUNIAO_COM_PRESENCA:        409,
  REUNIAO_COM_DOCUMENTO:       409,
  CONVITE_DUPLICADO:           409,

  // ---------------------------------------------------- Bloco C (documentos)
  INSTITUICAO_COM_DOCUMENTO:   409,

// 413 e 415 são os códigos próprios do HTTP para tamanho e tipo.
  ARQUIVO_GRANDE_DEMAIS:       413,
  TIPO_NAO_PERMITIDO:          415,

// Documento que é só link não tem conteúdo para baixar: a tela chamou a rota errada.
  DOCUMENTO_E_LINK:            409,
};

export class ErroDeNegocio extends Error {
  /**
   * @param {CodigoErro} codigo
   * @param {string} mensagem
   * @param {Record<string, unknown>} [extra]
   */
  constructor(codigo, mensagem, extra) {
    super(mensagem);
    this.name = 'ErroDeNegocio';
    /** @type {CodigoErro} */
    this.codigo = codigo;
    /** @type {Record<string, unknown>|undefined} */
    this.extra = extra;
  }

  /** @returns {number} */
  get status() {
    return HTTP[this.codigo];
  }
}

/**
 * @param {CodigoErro} codigo
 * @returns {number}
 */
export function statusDoCodigo(codigo) {
  return HTTP[codigo];
}
