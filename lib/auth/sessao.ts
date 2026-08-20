import { redirect } from 'next/navigation';
import { criarClienteServidor } from '../supabase/servidor';
import { pode, type Acao, type Papel, type Recurso } from '../dominio/permissoes';

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
}

/**
 * Usuário autenticado da requisição atual, já com o papel resolvido.
 * Devolve null se não houver sessão.
 */
export async function usuarioAtual(): Promise<UsuarioSessao | null> {
  const supabase = criarClienteServidor();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('usuario')
    .select('id, nome, email, papel, ativo')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as UsuarioSessao;
}

/** Igual ao anterior, mas manda para o login quando não há sessão. */
export async function exigirUsuario(destino?: string): Promise<UsuarioSessao> {
  const u = await usuarioAtual();
  if (!u) {
    redirect(`/login${destino ? `?redirecionar=${encodeURIComponent(destino)}` : ''}`);
  }
  if (!u.ativo) redirect('/login?erro=inativo');
  return u;
}

/** Exige uma permissão específica. Use em Server Component ou Server Action. */
export async function exigirPermissao(recurso: Recurso, acao: Acao): Promise<UsuarioSessao> {
  const u = await exigirUsuario();
  if (!pode(u.papel, recurso, acao)) redirect('/sem-permissao');
  return u;
}
