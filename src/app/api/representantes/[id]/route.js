/**
 * APRESENTAÇÃO — um representante (RF41, RF44).
 *
 *   GET   /api/representantes/:id    detalhe + histórico de participação
 *   PATCH /api/representantes/:id
 */
import { obterRepresentante } from '@/aplicacao/representantes/obter-representante.js';
import { editarRepresentante } from '@/aplicacao/representantes/editar-representante.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(_req, { params }) {
  try {
    return ok(await obterRepresentante(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function PATCH(req, { params }) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await editarRepresentante(usuario, params.id, corpo));
  } catch (e) {
    return falha(e);
  }
}
