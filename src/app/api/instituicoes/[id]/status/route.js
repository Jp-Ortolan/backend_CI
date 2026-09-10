/**
 * APRESENTAÇÃO — ativar / desativar instituição (RF09, RF10).
 *
 *   POST /api/instituicoes/:id/status   { "status": "inativa", "dataSaida": "2026-09-07" }
 *
 * Rota própria, e não um PATCH comum: trocar a situação tem regra que o update
 * genérico não tem (exigir data de saída, limpar a data ao reativar) e gera
 * linha no histórico de status.
 */
import { alterarStatusInstituicao } from '@/aplicacao/instituicoes/alterar-status-instituicao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function POST(req, { params }) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await alterarStatusInstituicao(usuario, params.id, corpo));
  } catch (e) {
    return falha(e);
  }
}
