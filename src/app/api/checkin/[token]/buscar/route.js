/**
 * APRESENTAÇÃO — busca de participante na tela de check-in (RF28).
 *
 * É a rota pública que mais expõe dado (nome, instituição e cargo de até 5
 * pessoas), por isso o limite por IP aqui é mais apertado que no registro.
 */
import { buscarParticipante } from '@/aplicacao/checkin/buscar-participante.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { exigirDentroDoLimite, ipDaRequisicao } from '@/infraestrutura/http/limite.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { token: string } }} contexto
 */
export async function GET(req, { params }) {
  try {
    await exigirDentroDoLimite('buscar', ipDaRequisicao(req), params.token);

    const termo = req.nextUrl.searchParams.get('nome') ?? '';
    return ok(await buscarParticipante(params.token, termo));
  } catch (e) {
    return falha(e);
  }
}
