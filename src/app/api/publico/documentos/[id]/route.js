/**
 * APRESENTAÇÃO — download de documento público.
 *
 *   GET /api/publico/documentos/:id
 */
import { documentoPublico } from '@/aplicacao/publico/painel-publico.js';
import { falha } from '@/infraestrutura/http/resposta.js';
import { respostaDeArquivo } from '@/infraestrutura/http/arquivo.js';
import { exigirDentroDoLimite, ipDaRequisicao } from '@/infraestrutura/http/limite.js';
import { sanitizarNome } from '@/dominio/arquivos.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(req, { params }) {
  try {
    await exigirDentroDoLimite('publico', ipDaRequisicao(req));
    const d = await documentoPublico(params.id);
    return respostaDeArquivo({ ...d, nome: sanitizarNome(d.nome), publico: true });
  } catch (e) {
    return falha(e);
  }
}
