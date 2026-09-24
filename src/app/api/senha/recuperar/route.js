/**
 * APRESENTAÇÃO — pedir o link de recuperação de senha (RF02).
 *
 *   POST /api/senha/recuperar   { "email": "..." }
 *
 * Responde sempre 200 com a mesma mensagem, exista ou não a conta: o contrário
 * transformaria a rota num verificador de quem tem cadastro.
 */
import { pedirRecuperacao } from '@/aplicacao/autenticacao/recuperar-senha.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const corpo = await req.json().catch(() => null);
    const r = await pedirRecuperacao({ email: String(corpo?.email ?? '') });
    if (!r.ok) throw new ErroDeNegocio('DADOS_INVALIDOS', r.erro);
    return ok({ mensagem: r.mensagem });
  } catch (e) {
    return falha(e);
  }
}
