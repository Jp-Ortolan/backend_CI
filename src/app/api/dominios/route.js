/**
 * APRESENTAÇÃO — opções dos selects de classificação.
 *
 *   GET /api/dominios
 *
 * Tipos de instituição, áreas de atuação e os rótulos de situação, numa
 * resposta só — é o que o formulário de cadastro precisa para abrir.
 */
import { listarDominios } from '@/aplicacao/dominios/listar-dominios.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    const incluirInativos = req.nextUrl.searchParams.get('incluirInativos') === 'true';
    return ok(await listarDominios(await usuarioAtual(), { incluirInativos }));
  } catch (e) {
    return falha(e);
  }
}
