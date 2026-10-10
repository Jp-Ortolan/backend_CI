/**
 * APRESENTAÇÃO — painel público (sem login).
 *
 *   GET /api/publico   indicadores, Diretoria, próximas atividades e links oficiais
 *
 * Demais rotas públicas:
 *   GET /api/publico/instituicoes?tipo=&vertente=&area=&busca=
 *   GET /api/publico/instituicoes/:id/logo
 *   GET /api/publico/agenda?de=&ate=
 *   GET /api/publico/documentos
 *   GET /api/publico/documentos/:id
 *
 * Sem sessão: o middleware deixa passar tudo sob /api/publico. Com limite por IP.
 */
import { painelPublico } from '@/aplicacao/publico/painel-publico.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { exigirDentroDoLimite, ipDaRequisicao } from '@/infraestrutura/http/limite.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    await exigirDentroDoLimite('publico', ipDaRequisicao(req));
    return ok(await painelPublico());
  } catch (e) {
    return falha(e);
  }
}
