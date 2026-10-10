/**
 * APRESENTAÇÃO — documentos públicos do Fórum.
 *
 *   GET /api/publico/documentos   Regimento, planejamento, atas aprovadas, relatórios
 */
import { documentosPublicos } from '@/aplicacao/publico/painel-publico.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { exigirDentroDoLimite, ipDaRequisicao } from '@/infraestrutura/http/limite.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    await exigirDentroDoLimite('publico', ipDaRequisicao(req));
    return ok(await documentosPublicos());
  } catch (e) {
    return falha(e);
  }
}
