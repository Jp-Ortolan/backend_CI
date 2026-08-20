/**
 * APRESENTAÇÃO — encerramento de vínculo (RF16).
 */
import { encerrarVinculo } from '@/aplicacao/vinculos/encerrar-vinculo.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function POST(req, { params }) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await encerrarVinculo(usuario, params.id, corpo));
  } catch (e) {
    return falha(e);
  }
}
