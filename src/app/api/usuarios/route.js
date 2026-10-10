/**
 * APRESENTAÇÃO — contas de acesso (só administrador).
 *
 *   GET  /api/usuarios?busca=&papel=&instituicaoId=&ativo=
 *   POST /api/usuarios   { nome, email, papel, instituicaoId?, pessoaId? }
 *
 * A conta nasce sem senha; a pessoa recebe por e-mail o link para definir a dela.
 */
import { listarUsuarios, criarUsuario } from '@/aplicacao/usuarios/usuarios.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    return ok(await listarUsuarios(await usuarioAtual(), Object.fromEntries(req.nextUrl.searchParams)));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await criarUsuario(usuario, corpo), 201);
  } catch (e) {
    return falha(e);
  }
}
