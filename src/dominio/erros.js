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
 *   |'NAO_AUTENTICADO'|'SEM_PERMISSAO'|'ERRO_INTERNO'} CodigoErro
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
