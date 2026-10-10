/**
 * APRESENTAÇÃO — encaminhamentos da reunião.
 *
 *   GET  /api/reunioes/:id/encaminhamentos
 *   POST /api/reunioes/:id/encaminhamentos   { descricao, responsavel, prazo, ... }
 */
import { listarEncaminhamentos, criarEncaminhamento } from '@/aplicacao/encaminhamentos/encaminhamentos.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(_req, { params }) {
  try {
    return ok(await listarEncaminhamentos(await usuarioAtual(), params.id));
  } catch (e) {
    return falha(e);
  }
}

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function POST(req, { params }) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await criarEncaminhamento(usuario, params.id, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
