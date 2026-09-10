/**
 * APRESENTAÇÃO — coleção de instituições (RF06, RF11, RF12).
 *
 *   GET  /api/instituicoes?busca=&status=&tipoInstituicaoId=&cidade=&pagina=&porPagina=
 *   POST /api/instituicoes
 */
import { listarInstituicoes } from '@/aplicacao/instituicoes/listar-instituicoes.js';
import { criarInstituicao } from '@/aplicacao/instituicoes/criar-instituicao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    const usuario = await usuarioAtual();
    // Object.fromEntries descarta repetições do mesmo parâmetro, o que é o
    // comportamento desejado: nenhum filtro desta tela aceita valor múltiplo.
    const filtros = Object.fromEntries(req.nextUrl.searchParams);
    return ok(await listarInstituicoes(usuario, filtros));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await criarInstituicao(usuario, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
