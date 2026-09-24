/**
 * Log da aplicação: uma linha JSON por evento, no stdout.
 *
 * Senha, hash, token de sessão, token de recuperação e qr_token nunca entram —
 * `limpar()` tira esses campos pelo nome antes de escrever.
 */

/** Campos que nunca são escritos, não importa de onde venham. */
const PROIBIDOS = new Set([
  'senha', 'password', 'senha_hash', 'senhaHash',
  'token', 'tokenHash', 'token_hash', 'qrToken', 'qr_token',
  'authorization', 'cookie', 'sessao',
]);

/**
 * @param {unknown} valor
 * @param {number} [profundidade]
 * @returns {unknown}
 */
function limpar(valor, profundidade = 0) {
  if (profundidade > 4 || valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.slice(0, 20).map((v) => limpar(v, profundidade + 1));

  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [chave, v] of Object.entries(valor)) {
    saida[chave] = PROIBIDOS.has(chave) ? '[omitido]' : limpar(v, profundidade + 1);
  }
  return saida;
}

/**
 * @param {'debug'|'info'|'aviso'|'erro'} nivel
 * @param {string} evento
 * @param {Record<string, unknown>} [dados]
 */
function escrever(nivel, evento, dados = {}) {
  const linha = {
    nivel,
    evento,
    em: new Date().toISOString(),
    ...(/** @type {Record<string, unknown>} */ (limpar(dados))),
  };

  const texto = JSON.stringify(linha);
  if (nivel === 'erro') console.error(texto);
  else if (nivel === 'aviso') console.warn(texto);
  else console.log(texto);
}

export const log = {
  /** @param {string} evento @param {Record<string, unknown>} [dados] */
  debug: (evento, dados) => {
    if (process.env.LOG_NIVEL === 'debug') escrever('debug', evento, dados);
  },
  /** @param {string} evento @param {Record<string, unknown>} [dados] */
  info: (evento, dados) => escrever('info', evento, dados),
  /** @param {string} evento @param {Record<string, unknown>} [dados] */
  aviso: (evento, dados) => escrever('aviso', evento, dados),

  /**
   * @param {string} evento
   * @param {unknown} erro
   * @param {Record<string, unknown>} [dados]
   */
  erro: (evento, erro, dados = {}) => {
    const e = /** @type {any} */ (erro);
    escrever('erro', evento, {
      ...dados,
      mensagem: e?.message ?? String(erro),
// O código do Postgres é o que mais ajuda a diagnosticar sem reproduzir.
      codigoBanco: e?.code,
      restricao: e?.constraint,
      pilha: process.env.NODE_ENV === 'production' ? undefined : e?.stack,
    });
  },
};
