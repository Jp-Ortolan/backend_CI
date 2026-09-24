import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens de sessão e de recuperação de senha.
 * O valor sorteado vai no cookie ou no link; no banco fica só o SHA-256 dele.
 * SHA-256 basta porque o token já é aleatório de 256 bits.
 *
 * @returns {string}
 */
export function gerarToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Comparação em tempo constante, para não vazar informação pelo tempo de resposta.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function iguais(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const DURACAO_SESSAO_HORAS = 12;
export const DURACAO_RECUPERACAO_MINUTOS = 60;
