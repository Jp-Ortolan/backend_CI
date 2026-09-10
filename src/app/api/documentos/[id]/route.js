/**
 * APRESENTAÇÃO — um documento.
 *
 *   DELETE /api/documentos/:id
 */
import { removerDocumento } from '@/aplicacao/documentos/remover-documento.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function DELETE(_req, { params }) {
  try {
    return ok(await removerDocumento(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}
