/**
 * APRESENTAÇÃO — ajustar a representação.
 *
 *   PATCH /api/vinculos/:id   { tipoRepresentacao, cargo, cargoForum, grupoTrabalhoIds }
 */
import { editarVinculo } from '@/aplicacao/vinculos/editar-vinculo.js';
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
    return ok(await editarVinculo(usuario, params.id, corpo));
  } catch (e) {
    return falha(e);
  }
}
