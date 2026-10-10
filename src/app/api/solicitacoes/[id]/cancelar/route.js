/**
 * APRESENTAÇÃO — cancelar a própria solicitação.
 *
 *   POST /api/solicitacoes/:id/cancelar
 */
import { cancelarSolicitacao } from '@/aplicacao/solicitacoes/cancelar-solicitacao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function POST(_req, { params }) {
  try {
    return ok(await cancelarSolicitacao(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}
