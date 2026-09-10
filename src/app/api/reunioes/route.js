/**
 * APRESENTAÇÃO — coleção de reuniões (RF23, RF24).
 *
 *   GET  /api/reunioes?busca=&status=&periodo=proximas&instituicaoId=&pagina=
 *   POST /api/reunioes
 */
import { listarReunioes } from '@/aplicacao/reunioes/listar-reunioes.js';
import { criarReuniao } from '@/aplicacao/reunioes/criar-reuniao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    const filtros = Object.fromEntries(req.nextUrl.searchParams);
    return ok(await listarReunioes(await usuarioAtual(), filtros));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await criarReuniao(usuario, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
