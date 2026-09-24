/**
 * APRESENTAÇÃO — gravar a nova senha (RF02).
 *
 *   POST /api/senha/redefinir   { "token": "...", "senha": "...", "confirmacao": "..." }
 *
 * O token vem do link enviado por e-mail e vale uma vez só.
 */
import { redefinirSenha } from '@/aplicacao/autenticacao/recuperar-senha.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const corpo = await req.json().catch(() => null);
    const r = await redefinirSenha({
      token: String(corpo?.token ?? ''),
      senha: String(corpo?.senha ?? ''),
      confirmacao: String(corpo?.confirmacao ?? ''),
    });
    if (!r.ok) throw new ErroDeNegocio('DADOS_INVALIDOS', r.erro);
    return ok({ mensagem: r.mensagem });
  } catch (e) {
    return falha(e);
  }
}
