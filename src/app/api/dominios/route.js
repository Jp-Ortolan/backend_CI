/**
 * APRESENTAÇÃO — opções dos selects.
 *
 *   GET  /api/dominios                tudo o que os formulários precisam
 *   POST /api/dominios                { lista: "vertentes", nome: "..." }          cria
 *                                     { lista: "gruposTrabalho", id: 3, ativo: false } altera
 *
 * Listas mantidas pela gestão: vertentes, gruposTrabalho, tiposInstituicao,
 * areasAtuacao, tiposAtividade.
 */
import { listarDominios } from '@/aplicacao/dominios/listar-dominios.js';
import { gravarDominio } from '@/aplicacao/dominios/gravar-dominio.js';
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

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await gravarDominio(usuario, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
