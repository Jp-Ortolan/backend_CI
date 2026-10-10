/**
 * APRESENTAÇÃO — relatório de participação por instituição.
 *
 *   GET /api/relatorios/participacao?de=2026-01-01&ate=2026-12-31&formato=csv
 *
 * Gestão: todas as instituições. Representante: só a dele (relatório próprio).
 * formato=csv devolve o arquivo para o Excel; sem formato, JSON (o PDF é
 * montado no front a partir dele).
 */
import { participacaoPorInstituicao } from '@/aplicacao/relatorios/participacao.js';
import { exportarParticipacao } from '@/aplicacao/relatorios/exportar.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { respostaDeArquivo } from '@/infraestrutura/http/arquivo.js';
import { exigir } from '@/aplicacao/guarda.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    const usuario = await usuarioAtual();
    const filtros = Object.fromEntries(req.nextUrl.searchParams);
    if (filtros.formato === 'csv') {
      exigir(usuario, 'relatorio', 'exportar');
      return respostaDeArquivo(await exportarParticipacao(usuario, filtros));
    }
    return ok(await participacaoPorInstituicao(usuario, filtros));
  } catch (e) {
    return falha(e);
  }
}
