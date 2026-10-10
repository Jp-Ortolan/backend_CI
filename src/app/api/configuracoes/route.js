/**
 * APRESENTAÇÃO — configurações do painel público.
 *
 *   GET   /api/configuracoes   admin e Diretoria
 *   PATCH /api/configuracoes   só admin   { link_manifestacao_interesse, linktree, canais_oficiais }
 */
import { obterConfiguracao, salvarConfiguracao } from '@/aplicacao/configuracao/configuracao.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok(await obterConfiguracao(await usuarioAtual()));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function PATCH(req) {
  try {
    const usuario = await usuarioAtual();
    const corpo = await req.json().catch(() => null);
    return ok(await salvarConfiguracao(usuario, corpo));
  } catch (e) {
    return falha(e);
  }
}
