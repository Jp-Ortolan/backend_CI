import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { consulta, consultaUm } from '../db/consulta.js';
import { pode } from '../dominio/permissoes.js';
import { DURACAO_SESSAO_HORAS, gerarToken, hashToken } from './tokens.js';

export const COOKIE_SESSAO = 'sessao';

/**
 * @typedef {object} UsuarioSessao
 * @property {string} id
 * @property {string} nome
 * @property {string} email
 * @property {import('../dominio/permissoes.js').Papel} papel
 * @property {boolean} ativo
 */

/**
 * Cria a sessão e grava o cookie.
 *
 * httpOnly    — JavaScript da página não lê o cookie, então um XSS não rouba a sessão
 * sameSite    — o cookie não viaja em requisição vinda de outro site (proteção CSRF)
 * secure      — só trafega em HTTPS fora do ambiente local
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
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
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

/**
 * Igual ao anterior, mas manda para o login quando não há sessão válida.
 *
 * @param {string} [destino]
 * @returns {Promise<UsuarioSessao>}
 */
export async function exigirUsuario(destino) {
  const u = await usuarioAtual();
  if (!u) {
    redirect(`/login${destino ? `?redirecionar=${encodeURIComponent(destino)}` : ''}`);
  }
  return u;
}

/**
 * Exige uma permissão específica. Use em Server Component ou Server Action.
 *
 * @param {import('../dominio/permissoes.js').Recurso} recurso
 * @param {import('../dominio/permissoes.js').Acao} acao
 * @returns {Promise<UsuarioSessao>}
 */
export async function exigirPermissao(recurso, acao) {
  const u = await exigirUsuario();
  if (!pode(u.papel, recurso, acao)) redirect('/sem-permissao');
  return u;
}
