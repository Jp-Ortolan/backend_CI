/**
 * APRESENTAÇÃO — marcação manual de presença (RF37, RF38).
 *
 *   POST /api/reunioes/:id/presencas
 *   { "pessoaId": "uuid", "status": "presente", "observacoes": "Chegou 09:30" }
 *
 * É o que resolve o celular sem bateria e a justificativa mandada na véspera.
 * Reenviar para a mesma pessoa corrige a marcação anterior em vez de duplicar.
 */
import { marcarPresenca } from '@/aplicacao/presencas/marcar-presenca.js';
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
    return ok(await marcarPresenca(usuario, params.id, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
