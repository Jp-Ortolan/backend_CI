'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { consulta, consultaUm } from '@/lib/db/consulta';
import { abrirSessao, encerrarSessao } from '@/lib/auth/sessao';
import { conferir, gerarHash, SENHA_MINIMA } from '@/lib/auth/senha';
import { DURACAO_RECUPERACAO_MINUTOS, gerarToken, hashToken } from '@/lib/auth/tokens';
import { enviar } from '@/lib/email/enviar';
import type { PapelUsuario } from '@/lib/tipos-banco';

export interface EstadoForm {
  erro?: string;
  sucesso?: string;
}

interface Credenciais {
  id: string; nome: string; email: string;
  senha_hash: string | null; papel: PapelUsuario; ativo: boolean;
}

const esquemaLogin = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  senha: z.string().min(1, 'Informe sua senha.'),
  redirecionar: z.string().optional(),
});

/**
 * RF01 — entrar.
 *
 * A mensagem é sempre a mesma para e-mail inexistente, senha errada e conta
 * desativada. Diferenciar entregaria a quem tentar a lista de quem tem conta.
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

  const u = await consultaUm<Credenciais>(
    'select id, nome, email, senha_hash, papel, ativo from auth_credenciais($1)',
    [analise.data.email],
  );

  const senhaConfere = await conferir(analise.data.senha, u?.senha_hash ?? null);
  if (!u || !u.ativo || !senhaConfere) {
    return { erro: 'E-mail ou senha incorretos.' };
  }

  const cabecalhos = headers();
  await abrirSessao(
    u.id,
    cabecalhos.get('x-forwarded-for'),
    cabecalhos.get('user-agent'),
  );

  revalidatePath('/', 'layout');
  redirect(analise.data.redirecionar || '/dashboard');
}

const esquemaEmail = z.object({ email: z.string().trim().email('Informe um e-mail válido.') });

/**
 * RF02 — pedir recuperação de senha.
 *
 * Responde sempre a mesma coisa, exista ou não a conta, para o formulário não
 * virar um verificador de e-mails cadastrados.
 */
export async function pedirRecuperacao(_estado: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const analise = esquemaEmail.safeParse({ email: dados.get('email') });
  if (!analise.success) {
    return { erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const token = gerarToken();
  const expira = new Date(Date.now() + DURACAO_RECUPERACAO_MINUTOS * 60_000);

  await consulta('select auth_criar_token_recuperacao($1, $2, $3)', [
    analise.data.email, hashToken(token), expira.toISOString(),
  ]);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  await enviar({
    para: analise.data.email,
    assunto: 'Redefinir sua senha — Ecossistema de Inovação',
    texto: [
      'Você pediu para redefinir sua senha no Sistema de Gestão do Ecossistema de Inovação.',
      '',
      `Abra este link para escolher uma nova senha (vale por ${DURACAO_RECUPERACAO_MINUTOS} minutos):`,
      `${base}/redefinir-senha?token=${token}`,
      '',
      'Se não foi você que pediu, ignore este e-mail: nada muda até que o link seja usado.',
    ].join('\n'),
  });

  return {
    sucesso: 'Se existir uma conta com esse e-mail, enviamos as instruções para redefinir a senha.',
  };
}

const esquemaNovaSenha = z.object({
  token: z.string().min(1, 'Link inválido.'),
  senha: z.string().min(SENHA_MINIMA, `A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.`),
  confirmacao: z.string(),
}).refine(d => d.senha === d.confirmacao, {
  message: 'As duas senhas não conferem.', path: ['confirmacao'],
});

/** RF02 — gravar a nova senha. O token só vale uma vez. */
export async function redefinirSenha(_estado: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const analise = esquemaNovaSenha.safeParse({
    token: dados.get('token'),
    senha: dados.get('senha'),
    confirmacao: dados.get('confirmacao'),
  });
  if (!analise.success) {
    return { erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const linha = await consultaUm<{ auth_usar_token_recuperacao: string | null }>(
    'select auth_usar_token_recuperacao($1)', [hashToken(analise.data.token)],
  );
  const usuarioId = linha?.auth_usar_token_recuperacao ?? null;

  if (!usuarioId) {
    return { erro: 'Este link expirou ou já foi usado. Peça a recuperação de senha novamente.' };
  }

  await consulta('select auth_definir_senha($1, $2)', [
    usuarioId, await gerarHash(analise.data.senha),
  ]);

  return { sucesso: 'Senha alterada. Você já pode entrar com a nova senha.' };
}

export async function sair(): Promise<void> {
  await encerrarSessao();
  revalidatePath('/', 'layout');
  redirect('/login');
}
