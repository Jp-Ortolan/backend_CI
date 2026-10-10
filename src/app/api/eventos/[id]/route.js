/**
 * APRESENTAÇÃO — um evento.
 *
 *   GET    /api/eventos/:id
 *   PATCH  /api/eventos/:id
 *   DELETE /api/eventos/:id
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
    return ok(await obterReuniao(await usuarioAtual(), params.id, 'evento'));
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
    return ok(await editarReuniao(usuario, params.id, corpo, 'evento'));
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
    return ok(await excluirReuniao(await usuarioAtual(), params.id, 'evento'));
  } catch (e) {
    return falha(e);
  }
}
