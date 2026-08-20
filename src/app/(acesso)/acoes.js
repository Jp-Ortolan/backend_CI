'use server';

/**
 * APRESENTAÇÃO — Server Actions das telas de acesso.
 *
 * O trabalho daqui é só de tradução: pegar o FormData que o navegador mandou,
 * entregar valores simples ao caso de uso e devolver o que a tela precisa
 * mostrar. Toda a regra está em src/aplicacao/autenticacao/.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { entrar as casoDeUsoEntrar } from '@/aplicacao/autenticacao/entrar.js';
import {
  pedirRecuperacao as casoDeUsoPedir,
  redefinirSenha as casoDeUsoRedefinir,
} from '@/aplicacao/autenticacao/recuperar-senha.js';
import { encerrarSessao } from '@/infraestrutura/seguranca/sessao.js';

/**
 * O que a tela recebe de volta.
 *
 * @typedef {object} EstadoForm
 * @property {string} [erro]
 * @property {string} [sucesso]
 */

/**
 * RF01 — entrar.
 *
 * @param {EstadoForm} _estado
 * @param {FormData} dados
 * @returns {Promise<EstadoForm>}
 */
export async function entrar(_estado, dados) {
  const cabecalhos = headers();

  const r = await casoDeUsoEntrar({
    email: String(dados.get('email') ?? ''),
    senha: String(dados.get('senha') ?? ''),
    ip: cabecalhos.get('x-forwarded-for'),
    agente: cabecalhos.get('user-agent'),
  });

  if (!r.ok) return { erro: r.erro };

  revalidatePath('/', 'layout');
  redirect(String(dados.get('redirecionar') || '/dashboard'));
}

/**
 * RF02 — pedir o link de recuperação.
 *
 * @param {EstadoForm} _estado
 * @param {FormData} dados
 * @returns {Promise<EstadoForm>}
 */
export async function pedirRecuperacao(_estado, dados) {
  const r = await casoDeUsoPedir({ email: String(dados.get('email') ?? '') });
  return r.ok ? { sucesso: r.mensagem } : { erro: r.erro };
}

/**
 * RF02 — gravar a nova senha.
 *
 * @param {EstadoForm} _estado
 * @param {FormData} dados
 * @returns {Promise<EstadoForm>}
 */
export async function redefinirSenha(_estado, dados) {
  const r = await casoDeUsoRedefinir({
    token: String(dados.get('token') ?? ''),
    senha: String(dados.get('senha') ?? ''),
    confirmacao: String(dados.get('confirmacao') ?? ''),
  });
  return r.ok ? { sucesso: r.mensagem } : { erro: r.erro };
}

/** Encerra a sessão e volta para o login. */
export async function sair() {
  await encerrarSessao();
  revalidatePath('/', 'layout');
  redirect('/login');
}
