import { cookies } from 'next/headers';
import { consulta, consultaUm } from '@/infraestrutura/banco/consulta.js';
import { DURACAO_SESSAO_HORAS, gerarToken, hashToken } from './tokens.js';

export const COOKIE_SESSAO = 'sessao';

/**
 * Front e API no mesmo domínio: 'lax' basta e protege contra CSRF. Em domínios
 * diferentes o navegador só manda o cookie com sameSite 'none' + secure — daí a
 * variável COOKIE_CROSS_SITE, que também exige HTTPS dos dois lados.
 */
const ENTRE_DOMINIOS = process.env.COOKIE_CROSS_SITE === '1';

/**
 * @typedef {object} UsuarioSessao
 * @property {string} id
 * @property {string} nome
 * @property {string} email
 * @property {import('@/dominio/permissoes.js').Papel} papel
 * @property {boolean} ativo
 */

/**
 * Cria a sessão e grava o cookie.
 *
 * httpOnly  — JavaScript da página não lê o cookie, então um XSS não rouba a sessão
 * sameSite  — de onde o cookie pode viajar (ver ENTRE_DOMINIOS acima)
 * secure    — só trafega em HTTPS
 *
 * @param {string} usuarioId
 * @param {string|null} [ip]
 * @param {string|null} [agente]
 * @returns {Promise<void>}
 */
export async function abrirSessao(usuarioId, ip, agente) {
  const token = gerarToken();
  const expira = new Date(Date.now() + DURACAO_SESSAO_HORAS * 3600_000);

  await consulta('select auth_criar_sessao($1, $2, $3, $4, $5)', [
    usuarioId, hashToken(token), expira.toISOString(), ip ?? null, agente ?? null,
  ]);

  cookies().set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: ENTRE_DOMINIOS ? 'none' : 'lax',
    secure: ENTRE_DOMINIOS || process.env.NODE_ENV === 'production',
    path: '/',
    expires: expira,
  });
}

/** @returns {Promise<void>} */
export async function encerrarSessao() {
  const token = cookies().get(COOKIE_SESSAO)?.value;
  if (token) {
    await consulta('select auth_encerrar_sessao($1)', [hashToken(token)]);
  }
  cookies().delete(COOKIE_SESSAO);
}

/**
 * Usuário da requisição atual, já com o papel resolvido. Null se não houver sessão.
 *
 * @returns {Promise<UsuarioSessao|null>}
 */
export async function usuarioAtual() {
  const token = cookies().get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  return consultaUm(
    'select id, nome, email, papel, ativo from auth_ler_sessao($1)',
    [hashToken(token)],
  );
}
