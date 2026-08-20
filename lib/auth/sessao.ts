import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { consulta, consultaUm } from '../db/consulta';
import { pode, type Acao, type Papel, type Recurso } from '../dominio/permissoes';
import { DURACAO_SESSAO_HORAS, gerarToken, hashToken } from './tokens';

export const COOKIE_SESSAO = 'sessao';

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
}

/**
 * Cria a sessão e grava o cookie.
 *
 * httpOnly    — JavaScript da página não lê o cookie, então um XSS não rouba a sessão
 * sameSite    — o cookie não viaja em requisição vinda de outro site (proteção CSRF)
 * secure      — só trafega em HTTPS fora do ambiente local
 */
export async function abrirSessao(
  usuarioId: string, ip?: string | null, agente?: string | null,
): Promise<void> {
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

export async function encerrarSessao(): Promise<void> {
  const token = cookies().get(COOKIE_SESSAO)?.value;
  if (token) {
    await consulta('select auth_encerrar_sessao($1)', [hashToken(token)]);
  }
  cookies().delete(COOKIE_SESSAO);
}

/** Usuário da requisição atual, já com o papel resolvido. Null se não houver sessão. */
export async function usuarioAtual(): Promise<UsuarioSessao | null> {
  const token = cookies().get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  return consultaUm<UsuarioSessao>(
    'select id, nome, email, papel, ativo from auth_ler_sessao($1)',
    [hashToken(token)],
  );
}

/** Igual ao anterior, mas manda para o login quando não há sessão válida. */
export async function exigirUsuario(destino?: string): Promise<UsuarioSessao> {
  const u = await usuarioAtual();
  if (!u) {
    redirect(`/login${destino ? `?redirecionar=${encodeURIComponent(destino)}` : ''}`);
  }
  return u;
}

/** Exige uma permissão específica. Use em Server Component ou Server Action. */
export async function exigirPermissao(recurso: Recurso, acao: Acao): Promise<UsuarioSessao> {
  const u = await exigirUsuario();
  if (!pode(u.papel, recurso, acao)) redirect('/sem-permissao');
  return u;
}
