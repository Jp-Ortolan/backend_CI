/**
 * APRESENTAÇÃO — um convite.
 *
 *   PATCH  /api/convites/:id   { "status": "confirmado" }
 *   DELETE /api/convites/:id
 */
import { responderConvite } from '@/aplicacao/convites/responder-convite.js';
import { removerConvite } from '@/aplicacao/convites/remover-convite.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function PATCH(req, { params }) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await responderConvite(usuario, params.id, corpo));
  } catch (e) {
    return falha(e);
  }
}

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function DELETE(_req, { params }) {
  try {
    return ok(await removerConvite(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}
