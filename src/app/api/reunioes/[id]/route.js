/**
 * APRESENTAÇÃO — uma reunião (RF25).
 *
 *   GET    /api/reunioes/:id
 *   PATCH  /api/reunioes/:id
 *   DELETE /api/reunioes/:id
 */
import { obterReuniao } from '@/aplicacao/reunioes/obter-reuniao.js';
import { editarReuniao } from '@/aplicacao/reunioes/editar-reuniao.js';
import { excluirReuniao } from '@/aplicacao/reunioes/excluir-reuniao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(_req, { params }) {
  try {
    return ok(await obterReuniao(await usuarioAtual(), params.id));
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
    return ok(await editarReuniao(usuario, params.id, corpo));
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
    return ok(await excluirReuniao(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}
