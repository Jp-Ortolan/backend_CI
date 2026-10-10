/**
 * APRESENTAÇÃO — logo autorizada, para <img src> no painel público.
 *
 *   GET /api/publico/instituicoes/:id/logo
 *
 * Sem limite por IP: uma página com 120 logos faria 120 requisições de uma vez.
 * O cache público de uma hora segura a repetição.
 */
import { logoPublica } from '@/aplicacao/publico/painel-publico.js';
import { falha } from '@/infraestrutura/http/resposta.js';
import { respostaDeArquivo } from '@/infraestrutura/http/arquivo.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(_req, { params }) {
  try {
    const { mimeType, conteudo } = await logoPublica(params.id);
    return respostaDeArquivo({ nome: 'logo', mimeType, conteudo, inline: true, publico: true });
  } catch (e) {
    return falha(e);
  }
}
