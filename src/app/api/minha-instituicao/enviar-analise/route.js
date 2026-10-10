/**
 * APRESENTAÇÃO — enviar o cadastro para análise da Diretoria.
 *
 *   POST /api/minha-instituicao/enviar-analise
 *
 * Responde DADOS_INVALIDOS com a lista `pendencias` quando falta algo.
 */
import { enviarParaAnalise } from '@/aplicacao/instituicoes/enviar-para-analise.js';
import { instituicaoDoRepresentante, exigir } from '@/aplicacao/guarda.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const u = exigir(await usuarioAtual(), 'instituicao', 'editar');
    return ok(await enviarParaAnalise(u, instituicaoDoRepresentante(u)));
  } catch (e) {
    return falha(e);
  }
}
