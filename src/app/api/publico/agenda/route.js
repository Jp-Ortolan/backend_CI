/**
 * APRESENTAÇÃO — calendário unificado público.
 *
 *   GET /api/publico/agenda?de=2026-10-01&ate=2026-12-31
 */
import { agendaPublica } from '@/aplicacao/publico/painel-publico.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { exigirDentroDoLimite, ipDaRequisicao } from '@/infraestrutura/http/limite.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    await exigirDentroDoLimite('publico', ipDaRequisicao(req));
    return ok(await agendaPublica(Object.fromEntries(req.nextUrl.searchParams)));
  } catch (e) {
    return falha(e);
  }
}
