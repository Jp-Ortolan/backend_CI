/**
 * APRESENTAÇÃO — reuniões e eventos da instituição do representante.
 *
 *   GET /api/minha-instituicao/atividades?natureza=reuniao&de=&ate=
 */
import { atividadesDaInstituicao } from '@/aplicacao/minha-instituicao/atividades.js';
import { instituicaoDoRepresentante, exigir } from '@/aplicacao/guarda.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    const u = exigir(await usuarioAtual(), 'presenca', 'ver');
    const filtros = Object.fromEntries(req.nextUrl.searchParams);
    return ok(await atividadesDaInstituicao(u, instituicaoDoRepresentante(u), filtros));
  } catch (e) {
    return falha(e);
  }
}
