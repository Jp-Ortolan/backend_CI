/**
 * APRESENTAÇÃO — indicadores do dashboard (RF46).
 *
 *   GET /api/indicadores
 */
import { obterDashboard } from '@/aplicacao/indicadores/obter-dashboard.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok(await obterDashboard(await usuarioAtual()));
  } catch (e) {
    return falha(e);
  }
}
