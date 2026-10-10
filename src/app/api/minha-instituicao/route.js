/**
 * APRESENTAÇÃO — área da instituição (revisão de outubro).
 *
 *   GET   /api/minha-instituicao     a ficha completa da instituição do representante
 *   PATCH /api/minha-instituicao     telefone, e-mail, endereço, redes, contatos, autorizações
 *
 * É a mesma regra de /api/instituicoes/:id, com o id vindo da conta — o front
 * não precisa saber o id da instituição do usuário para montar a tela.
 * Alteração sensível responde ALTERACAO_EXIGE_APROVACAO: use /api/solicitacoes.
 */
import { obterInstituicao } from '@/aplicacao/instituicoes/obter-instituicao.js';
import { editarInstituicao } from '@/aplicacao/instituicoes/editar-instituicao.js';
import { instituicaoDoRepresentante, exigir } from '@/aplicacao/guarda.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const u = exigir(await usuarioAtual(), 'instituicao', 'ver');
    return ok(await obterInstituicao(u, instituicaoDoRepresentante(u)));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function PATCH(req) {
  try {
    const u = exigir(await usuarioAtual(), 'instituicao', 'editar');
    const corpo = await req.json().catch(() => null);
    return ok(await editarInstituicao(u, instituicaoDoRepresentante(u), corpo));
  } catch (e) {
    return falha(e);
  }
}
