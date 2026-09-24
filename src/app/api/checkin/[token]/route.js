/**
 * APRESENTAÇÃO — check-in público.
 *
 * Só traduz web: lê a URL e o corpo, chama o caso de uso, devolve HTTP.
 * A exceção é o limite por IP (RNF14), que depende de informação de transporte
 * e por isso fica aqui, antes de qualquer trabalho.
 */
import { consultarReuniao } from '@/aplicacao/checkin/consultar-reuniao.js';
import { registrarPresenca } from '@/aplicacao/checkin/registrar-presenca.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { exigirDentroDoLimite, ipDaRequisicao } from '@/infraestrutura/http/limite.js';

export const dynamic = 'force-dynamic';

/**
 * GET — dados públicos da reunião, para montar a tela (RF27).
 *
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { token: string } }} contexto
 */
export async function GET(req, { params }) {
  try {
    await exigirDentroDoLimite('consultar', ipDaRequisicao(req), params.token);
    return ok(await consultarReuniao(params.token));
  } catch (e) {
    return falha(e);
  }
}

/**
 * POST — registra a presença (RF29 a RF34).
 *
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { token: string } }} contexto
 */
export async function POST(req, { params }) {
  try {
// Antes de ler o corpo: uma enxurrada não deve nem consumir o corpo, e a
// tentativa recusada também precisa contar.
    await exigirDentroDoLimite('registrar', ipDaRequisicao(req), params.token);

    const corpo = await req.json().catch(() => null);
    return ok(await registrarPresenca(params.token, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
