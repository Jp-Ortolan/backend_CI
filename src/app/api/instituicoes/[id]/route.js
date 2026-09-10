/**
 * APRESENTAÇÃO — uma instituição (RF07, RF08).
 *
 *   GET    /api/instituicoes/:id
 *   PATCH  /api/instituicoes/:id
 *   DELETE /api/instituicoes/:id
 */
import { obterInstituicao } from '@/aplicacao/instituicoes/obter-instituicao.js';
import { editarInstituicao } from '@/aplicacao/instituicoes/editar-instituicao.js';
import { excluirInstituicao } from '@/aplicacao/instituicoes/excluir-instituicao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(_req, { params }) {
  try {
    return ok(await obterInstituicao(await usuarioAtual(), params.id));
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
    return ok(await editarInstituicao(usuario, params.id, corpo));
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
    return ok(await excluirInstituicao(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}
