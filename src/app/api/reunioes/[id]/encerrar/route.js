/**
 * APRESENTAÇÃO — encerramento de reunião (RF39).
 */
import { encerrarReuniao } from '@/aplicacao/reunioes/encerrar-reuniao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function POST(_req, { params }) {
  try {
    const usuario = await usuarioAtual();
    return ok(await encerrarReuniao(usuario, params.id));
  } catch (e) {
    return falha(e);
  }
}
