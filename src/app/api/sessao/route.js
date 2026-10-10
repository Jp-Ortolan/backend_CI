/**
 * APRESENTAÇÃO — sessão do usuário (RF01, RF03).
 *
 *   POST   /api/sessao   { "email": "...", "senha": "..." }   entra
 *   GET    /api/sessao                                        quem está logado
 *   DELETE /api/sessao                                        sai
 *
 * Substitui as telas de login: o front-end é um projeto separado e conversa com
 * esta API por JSON. O cookie `sessao` é httpOnly e vai junto na resposta.
 */
import { entrar } from '@/aplicacao/autenticacao/entrar.js';
import { usuarioAtual, encerrarSessao } from '@/infraestrutura/seguranca/sessao.js';
import { montarPerfil } from '@/aplicacao/autenticacao/perfil.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * POST — entrar.
 *
 * @param {import('next/server').NextRequest} req
 */
export async function POST(req) {
  try {
    const corpo = await req.json().catch(() => null);

    const r = await entrar({
      email: String(corpo?.email ?? ''),
      senha: String(corpo?.senha ?? ''),
      ip: req.headers.get('x-forwarded-for'),
      agente: req.headers.get('user-agent'),
    });

    // O caso de uso devolve { ok: false, erro } em vez de lançar; aqui isso vira
    // o formato de erro do contrato.
    if (!r.ok) throw new ErroDeNegocio('NAO_AUTENTICADO', r.erro);

    return ok(await montarPerfil(r.usuario));
  } catch (e) {
    return falha(e);
  }
}

/** GET — quem está logado. 401 quando não há sessão válida. */
export async function GET() {
  try {
    const u = await usuarioAtual();
    if (!u) throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
    return ok(await montarPerfil(u));
  } catch (e) {
    return falha(e);
  }
}

/** DELETE — sair. Responde igual mesmo sem sessão: sair é idempotente. */
export async function DELETE() {
  try {
    await encerrarSessao();
    return ok({ encerrada: true });
  } catch (e) {
    return falha(e);
  }
}
