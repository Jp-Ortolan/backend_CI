/**
 * APRESENTAÇÃO — solicitações de alteração.
 *
 *   GET  /api/solicitacoes?status=pendente&tipo=&instituicaoId=&pagina=
 *   POST /api/solicitacoes   { tipo, dados, justificativa, documentoId, instituicaoId? }
 */
import { listarSolicitacoes } from '@/aplicacao/solicitacoes/listar-solicitacoes.js';
import { criarSolicitacao } from '@/aplicacao/solicitacoes/criar-solicitacao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    const filtros = Object.fromEntries(req.nextUrl.searchParams);
    return ok(await listarSolicitacoes(await usuarioAtual(), filtros));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await criarSolicitacao(usuario, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
