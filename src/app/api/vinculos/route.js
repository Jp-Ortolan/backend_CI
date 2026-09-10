/**
 * APRESENTAÇÃO — criação de vínculo (RF15).
 *
 *   POST /api/vinculos   { pessoaId, instituicaoId, cargo, dataInicio }
 *
 * O encerramento fica em /api/vinculos/:id/encerrar, que já existia.
 */
import { criarVinculo } from '@/aplicacao/representantes/criar-vinculo.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await criarVinculo(usuario, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
