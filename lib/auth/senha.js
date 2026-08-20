import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de senha com Argon2id.
 *
 * Argon2id é o algoritmo recomendado pela OWASP hoje: além de ser lento de
 * propósito, ele consome memória, o que encarece muito um ataque de força bruta
 * feito em placa de vídeo. Os parâmetros abaixo seguem a recomendação de 19 MiB.
 */
const OPCOES = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const SENHA_MINIMA = 8;

/**
 * @param {string} senha
 * @returns {Promise<string>}
 */
export function gerarHash(senha) {
  return hash(senha, OPCOES);
}

/**
 * Confere a senha. Devolve false em qualquer erro em vez de propagar — um hash
 * corrompido no banco não deve virar erro 500 na tela de login.
 *
 * @param {string} senha
 * @param {string|null} hashSalvo
 * @returns {Promise<boolean>}
 */
export async function conferir(senha, hashSalvo) {
  if (!hashSalvo) return false;
  try {
    return await verify(hashSalvo, senha, OPCOES);
  } catch {
    return false;
  }
}
