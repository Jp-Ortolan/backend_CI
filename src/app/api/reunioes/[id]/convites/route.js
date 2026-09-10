/**
 * APRESENTAÇÃO — convites de uma reunião.
 *
 *   POST /api/reunioes/:id/convites          convida todos os vínculos ativos
 *   POST /api/reunioes/:id/convites  { "vinculoIds": ["uuid", ...] }
 */
import { convidar } from '@/aplicacao/convites/convidar.js';
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
    return ok(await convidar(usuario, params.id, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
