/**
 * APRESENTAÇÃO — representantes (RF14, RF15, RF17).
 *
 *   GET  /api/representantes?busca=&instituicaoId=&vinculo=ativo
 *   POST /api/representantes
 */
import { listarRepresentantes } from '@/aplicacao/representantes/listar-representantes.js';
import { criarRepresentante } from '@/aplicacao/representantes/criar-representante.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    const filtros = Object.fromEntries(req.nextUrl.searchParams);
    return ok(await listarRepresentantes(await usuarioAtual(), filtros));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await criarRepresentante(usuario, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
