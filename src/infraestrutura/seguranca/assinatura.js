/**
 * Links temporários assinados (download de documento e de relatório).
 *
 * POR QUE NÃO O COOKIE
 * O front (Vercel) abre o arquivo num link para a API (Railway). Com o cookie
 * de sessão particionado entre domínios, uma aba nova aberta direto na API não
 * leva a sessão — e um link permanente para ofício seria um vazamento.
 * O contrato pede "URL temporária autorizada": o link carrega quem pode baixar,
 * o quê e até quando, com assinatura HMAC. Vale 15 minutos.
 *
 * SEGREDO_LINKS precisa ser o mesmo em todas as réplicas. Sem ele, cada
 * processo sorteia o seu (funciona com uma instância só; links emitidos antes
 * de um reinício deixam de valer).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SEGREDO = process.env.SEGREDO_LINKS || randomBytes(32).toString('hex');
export const VALIDADE_LINK_MINUTOS = 15;

const b64 = (s) => Buffer.from(s).toString('base64url');
const assinaturaDe = (corpo) => createHmac('sha256', SEGREDO).update(corpo).digest('base64url');

/**
 * @param {{ t: string, id: string, u?: string|null }} dados  t = tipo do recurso, u = usuário
 * @param {number} [minutos]
 * @returns {string}
 */
export function assinar(dados, minutos = VALIDADE_LINK_MINUTOS) {
  const corpo = b64(JSON.stringify({ ...dados, exp: Date.now() + minutos * 60_000 }));
  return `${corpo}.${assinaturaDe(corpo)}`;
}

/**
 * @param {string} token
 * @returns {{ t: string, id: string, u?: string|null, exp: number }|null}  null se inválido ou vencido
 */
export function verificar(token) {
  const [corpo, assinatura] = String(token ?? '').split('.');
  if (!corpo || !assinatura) return null;
  const esperada = Buffer.from(assinaturaDe(corpo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    return typeof dados.exp === 'number' && dados.exp > Date.now() ? dados : null;
  } catch {
    return null;
  }
}
