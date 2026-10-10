/**
 * APRESENTAÇÃO — uma conta (só administrador).
 *
 *   PATCH /api/usuarios/:id   { papel, instituicaoId, pessoaId, ativo, nome, email }
 *
 * Não há DELETE: conta se desativa (ativo: false). Apagar levaria junto a
 * autoria de tudo o que a pessoa cadastrou.
 */
import { editarUsuario } from '@/aplicacao/usuarios/usuarios.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function PATCH(req, { params }) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await editarUsuario(usuario, params.id, corpo));
  } catch (e) {
    return falha(e);
  }
}
