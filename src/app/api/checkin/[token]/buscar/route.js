/**
 * APRESENTAÇÃO — busca de participante na tela de check-in (RF28).
 */
import { buscarParticipante } from '@/aplicacao/checkin/buscar-participante.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { token: string } }} contexto
 */
export async function GET(req, { params }) {
  try {
    const termo = req.nextUrl.searchParams.get('nome') ?? '';
    return ok(await buscarParticipante(params.token, termo));
  } catch (e) {
    return falha(e);
  }
}
