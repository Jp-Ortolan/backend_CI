/**
 * APRESENTAÇÃO — cancelar, reabrir ou iniciar a reunião.
 *
 *   POST /api/reunioes/:id/status   { "status": "cancelada", "motivo": "..." }
 *
 * O encerramento é outro endpoint (`/encerrar`): ele marca os ausentes e fecha
 * o denominador dos indicadores, o que nenhuma outra transição faz.
 */
import { alterarStatusReuniao } from '@/aplicacao/reunioes/alterar-status-reuniao.js';
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
    return ok(await alterarStatusReuniao(usuario, params.id, corpo));
  } catch (e) {
    return falha(e);
  }
}
