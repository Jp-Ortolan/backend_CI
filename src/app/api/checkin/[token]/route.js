/**
 * APRESENTAÇÃO — check-in público.
 *
 * Esta camada só traduz web: lê a URL e o corpo, chama o caso de uso e
 * transforma o resultado (ou o erro) em resposta HTTP. Regra nenhuma mora aqui.
 */
import { consultarReuniao } from '@/aplicacao/checkin/consultar-reuniao.js';
import { registrarPresenca } from '@/aplicacao/checkin/registrar-presenca.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * GET — dados públicos da reunião, para montar a tela (RF27).
 *
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { token: string } }} contexto
 */
export async function GET(_req, { params }) {
  try {
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
    const corpo = await req.json().catch(() => null);
    return ok(await registrarPresenca(params.token, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
