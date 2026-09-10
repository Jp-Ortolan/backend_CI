/**
 * APRESENTAÇÃO — histórico de participação da instituição (RF42, RF45).
 *
 *   GET /api/instituicoes/:id/historico?de=2026-01-01&ate=2026-09-30
 *
 * Complementa o detalhe: lá vão os números consolidados, aqui a linha do tempo
 * reunião a reunião, com quem da instituição apareceu em cada uma.
 */
import { obterHistoricoInstituicao } from '@/aplicacao/historico/obter-historico-instituicao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(req, { params }) {
  try {
    const filtros = Object.fromEntries(req.nextUrl.searchParams);
    return ok(await obterHistoricoInstituicao(await usuarioAtual(), params.id, filtros));
  } catch (e) {
    return falha(e);
  }
}
