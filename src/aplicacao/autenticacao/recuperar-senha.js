/**
 * CASO DE USO — Recuperar e redefinir a senha (RF02).
 */
import { z } from 'zod';
import { consulta, consultaUm } from '@/infraestrutura/banco/consulta.js';
import { gerarHash, SENHA_MINIMA } from '@/infraestrutura/seguranca/senha.js';
import {
  DURACAO_RECUPERACAO_MINUTOS, gerarToken, hashToken,
} from '@/infraestrutura/seguranca/tokens.js';
import { enviar } from '@/infraestrutura/email/enviar.js';
import { urlDoFront } from '@/infraestrutura/http/front.js';

export const esquemaPedido = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
});

export const esquemaNovaSenha = z.object({
  token: z.string().min(1, 'Link inválido.'),
  senha: z.string().min(SENHA_MINIMA, `A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.`),
  confirmacao: z.string(),
}).refine(d => d.senha === d.confirmacao, {
  message: 'As duas senhas não conferem.', path: ['confirmacao'],
});

/**
 * Gera o token e manda o e-mail com o link.
 * Responde sempre igual, exista ou não a conta, senão o formulário viraria um
 * verificador de cadastro. Quem decide é a função do banco.
 *
 * @param {{ email: string }} entrada
 * @returns {Promise<{ ok: true, mensagem: string } | { ok: false, erro: string }>}
 */
export async function pedirRecuperacao({ email }) {
  const analise = esquemaPedido.safeParse({ email });
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const token = gerarToken();
  const expira = new Date(Date.now() + DURACAO_RECUPERACAO_MINUTOS * 60_000);

  await consulta('select auth_criar_token_recuperacao($1, $2, $3)', [
    analise.data.email, hashToken(token), expira.toISOString(),
  ]);

  const base = urlDoFront();
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
    ok: true,
    mensagem: 'Se existir uma conta com esse e-mail, enviamos as instruções para redefinir a senha.',
  };
}

/**
 * Grava a nova senha. O token só vale uma vez — quem gasta é a função do banco.
 *
 * @param {{ token: string, senha: string, confirmacao: string }} entrada
 * @returns {Promise<{ ok: true, mensagem: string } | { ok: false, erro: string }>}
 */
export async function redefinirSenha({ token, senha, confirmacao }) {
  const analise = esquemaNovaSenha.safeParse({ token, senha, confirmacao });
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const linha = await consultaUm(
    'select auth_usar_token_recuperacao($1)', [hashToken(analise.data.token)],
  );
  const usuarioId = linha?.auth_usar_token_recuperacao ?? null;

  if (!usuarioId) {
    return { ok: false, erro: 'Este link expirou ou já foi usado. Peça a recuperação de senha novamente.' };
  }

  await consulta('select auth_definir_senha($1, $2)', [
    usuarioId, await gerarHash(analise.data.senha),
  ]);

  return { ok: true, mensagem: 'Senha alterada. Você já pode entrar com a nova senha.' };
}
