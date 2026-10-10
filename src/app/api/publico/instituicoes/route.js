/**
 * APRESENTAÇÃO — instituições integrantes, para o painel público.
 *
 *   GET /api/publico/instituicoes?tipo=1&vertente=2&area=3&busca=uni
 *
 * Só aparecem as ativas que autorizaram a divulgação.
 */
import { instituicoesPublicas } from '@/aplicacao/publico/painel-publico.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { exigirDentroDoLimite, ipDaRequisicao } from '@/infraestrutura/http/limite.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    await exigirDentroDoLimite('publico', ipDaRequisicao(req));
    return ok(await instituicoesPublicas(Object.fromEntries(req.nextUrl.searchParams)));
  } catch (e) {
    return falha(e);
  }
}
