/**
 * CASO DE USO — Entrar no sistema (RF01).
 * Camada de aplicação: recebe dados simples e devolve dados simples; não sabe
 * que existe HTTP, formulário ou tela.
 */
import { z } from 'zod';
import { consultaUm } from '@/infraestrutura/banco/consulta.js';
import { abrirSessao } from '@/infraestrutura/seguranca/sessao.js';
import { conferir } from '@/infraestrutura/seguranca/senha.js';

export const esquemaEntrar = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  senha: z.string().min(1, 'Informe sua senha.'),
});

/**
 * @typedef {object} Credenciais
 * @property {string} id
 * @property {string} nome
 * @property {string} email
 * @property {string|null} senha_hash
 * @property {import('@/dominio/tipos.js').PapelUsuario} papel
 * @property {boolean} ativo
 */

/**
 * Confere as credenciais e, dando certo, abre a sessão.
 * A mensagem de erro é a mesma para e-mail inexistente, senha errada e conta
 * desativada: diferenciar entregaria a lista de quem tem conta.
 *
 * @param {{ email: string, senha: string, ip?: string|null, agente?: string|null }} entrada
 * @returns {Promise<{ ok: true, usuario: import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao }
 *   | { ok: false, erro: string }>}
 */
export async function entrar({ email, senha, ip = null, agente = null }) {
  const analise = esquemaEntrar.safeParse({ email, senha });
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  /** @type {Credenciais|null} */
  const u = await consultaUm(
    'select id, nome, email, senha_hash, papel, ativo from auth_credenciais($1)',
    [analise.data.email],
  );

// Confere mesmo sem o e-mail existir: pular deixaria a resposta mais rápida e
// o tempo entregaria o que a mensagem esconde.
  const senhaConfere = await conferir(analise.data.senha, u?.senha_hash ?? null);

  if (!u || !u.ativo || !senhaConfere) {
    return { ok: false, erro: 'E-mail ou senha incorretos.' };
  }

  await abrirSessao(u.id, ip, agente);

  // Devolve o usuário junto: o cookie acabou de ser gravado e ainda não está
  // legível nesta requisição, então uma segunda ida ao banco seria em vão.
  return {
    ok: true,
    usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel, ativo: u.ativo },
  };
}
