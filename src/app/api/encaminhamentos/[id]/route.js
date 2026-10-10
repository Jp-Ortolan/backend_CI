/**
 * APRESENTAÇÃO — um encaminhamento.
 *
 *   PATCH  /api/encaminhamentos/:id   { status: "concluido", ... }
 *   DELETE /api/encaminhamentos/:id
 */
import { editarEncaminhamento, excluirEncaminhamento } from '@/aplicacao/encaminhamentos/encaminhamentos.js';
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
    return ok(await editarEncaminhamento(usuario, params.id, corpo));
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
    return ok(await excluirEncaminhamento(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}
