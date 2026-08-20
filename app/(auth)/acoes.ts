'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { criarClienteServidor } from '@/lib/supabase/servidor';

export interface EstadoForm {
  erro?: string;
  sucesso?: string;
}

const esquemaLogin = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  senha: z.string().min(1, 'Informe sua senha.'),
  redirecionar: z.string().optional(),
});

/**
 * RF01 — entrar.
 *
 * A mensagem de erro é sempre a mesma para e-mail inexistente e senha errada.
 * Diferenciar as duas entrega a um curioso a lista de quem tem conta no sistema.
 */
export async function entrar(_estado: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const analise = esquemaLogin.safeParse({
    email: dados.get('email'),
    senha: dados.get('senha'),
    redirecionar: dados.get('redirecionar') ?? undefined,
  });
  if (!analise.success) {
    return { erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: analise.data.email,
    password: analise.data.senha,
  });

  if (error) return { erro: 'E-mail ou senha incorretos.' };

  // Conta desativada pela coordenação: existe no Auth, mas não deve entrar.
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    const { data: u } = await supabase
      .from('usuario').select('ativo').eq('id', auth.user.id).maybeSingle();
    if (u && u.ativo === false) {
      await supabase.auth.signOut();
      return { erro: 'Este acesso está desativado. Fale com a coordenação.' };
    }
  }

  revalidatePath('/', 'layout');
  redirect(analise.data.redirecionar || '/dashboard');
}

const esquemaEmail = z.object({ email: z.string().trim().email('Informe um e-mail válido.') });

/**
 * RF02 — pedir recuperação de senha.
 *
 * Responde sempre a mesma coisa, exista ou não a conta: caso contrário o
 * formulário vira um verificador de e-mails cadastrados.
 */
export async function pedirRecuperacao(_estado: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const analise = esquemaEmail.safeParse({ email: dados.get('email') });
  if (!analise.success) {
    return { erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = criarClienteServidor();
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  await supabase.auth.resetPasswordForEmail(analise.data.email, {
    redirectTo: `${base}/auth/callback?proximo=/redefinir-senha`,
  });

  return {
    sucesso: 'Se existir uma conta com esse e-mail, enviamos as instruções para redefinir a senha.',
  };
}

const esquemaNovaSenha = z.object({
  senha: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres.'),
  confirmacao: z.string(),
}).refine(d => d.senha === d.confirmacao, {
  message: 'As duas senhas não conferem.', path: ['confirmacao'],
});

/** RF02 — gravar a nova senha (o usuário chega aqui pelo link do e-mail). */
export async function redefinirSenha(_estado: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const analise = esquemaNovaSenha.safeParse({
    senha: dados.get('senha'),
    confirmacao: dados.get('confirmacao'),
  });
  if (!analise.success) {
    return { erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = criarClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { erro: 'O link expirou. Peça a recuperação de senha novamente.' };
  }

  const { error } = await supabase.auth.updateUser({ password: analise.data.senha });
  if (error) return { erro: 'Não foi possível alterar a senha. Tente novamente.' };

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

/** Sair. */
export async function sair(): Promise<void> {
  const supabase = criarClienteServidor();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
