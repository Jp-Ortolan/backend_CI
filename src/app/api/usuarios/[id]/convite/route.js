/**
 * APRESENTAÇÃO — reenviar o link de primeiro acesso.
 *
 *   POST /api/usuarios/:id/convite
 */
import { reenviarConvite } from '@/aplicacao/usuarios/usuarios.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function POST(_req, { params }) {
  try {
    return ok(await reenviarConvite(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}
