/**
 * APRESENTAÇÃO — lista de presença da reunião (RF35, RF36).
 *
 *   GET /api/reunioes/:id/participantes?situacao=presentes&instituicaoId=&busca=
 *   GET /api/reunioes/:id/participantes?formato=csv     lista de presença para o Excel
 *
 * Devolve convidados e presentes na mesma lista, mais os contadores de cada
 * aba — calculados sobre a lista completa, para "Presentes (12)" continuar
 * certo enquanto o usuário está filtrando os ausentes.
 */
import { listarParticipantes } from '@/aplicacao/convites/listar-participantes.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { exportarParticipantes } from '@/aplicacao/relatorios/exportar.js';
import { respostaDeArquivo } from '@/infraestrutura/http/arquivo.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(req, { params }) {
  try {
    const { formato, ...filtros } = Object.fromEntries(req.nextUrl.searchParams);
    if (formato === 'csv') {
      return respostaDeArquivo(await exportarParticipantes(await usuarioAtual(), params.id, filtros));
    }
    return ok(await listarParticipantes(await usuarioAtual(), params.id, filtros));
  } catch (e) {
    return falha(e);
  }
}
