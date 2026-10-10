/**
 * APRESENTAÇÃO — coleção de eventos (revisão de outubro).
 *
 *   GET  /api/eventos?busca=&status=&periodo=proximas&tipoAtividadeId=&pagina=
 *   POST /api/eventos
 *
 * Evento é registro separado de reunião (natureza = 'evento'), com os mesmos
 * casos de uso: presença, convite, QR Code e lista funcionam igual. As rotas
 * de detalhe (/api/eventos/:id/...) espelham as de /api/reunioes/:id/....
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
    return ok(await listarReunioes(await usuarioAtual(), filtros, 'evento'));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await criarReuniao(usuario, corpo, 'evento'), 201);
  } catch (e) {
    return falha(e);
  }
}
