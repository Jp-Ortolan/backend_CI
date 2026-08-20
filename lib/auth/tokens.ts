import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens de sessão e de recuperação de senha.
 *
 * O valor sorteado vai para o cookie ou para o link do e-mail; no banco fica
 * apenas o SHA-256 dele. Assim, quem conseguir ler a tabela não consegue montar
 * um cookie válido nem usar um link de recuperação.
 *
 * SHA-256 aqui é adequado (e não Argon2) porque o token já é aleatório de 256
 * bits — não há o que adivinhar, então o custo alto não traria ganho.
 */
export function gerarToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparação em tempo constante, para não vazar informação pelo tempo de resposta. */
export function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const DURACAO_SESSAO_HORAS = 12;
export const DURACAO_RECUPERACAO_MINUTOS = 60;
