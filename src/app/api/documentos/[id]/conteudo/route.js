/**
 * APRESENTAÇÃO — download do documento.
 *
 *   GET /api/documentos/:id/conteudo
 *
 * Os cabeçalhos são a parte importante daqui: o arquivo vem de um usuário e é
 * servido do mesmo domínio do sistema, então um HTML disfarçado de PDF rodaria
 * script na sessão de quem abrisse.
 *   Content-Disposition: attachment  — baixa, nunca abre na aba
 *   X-Content-Type-Options: nosniff  — o navegador não adivinha outro tipo
 *   Content-Security-Policy          — mesmo que escape, não executa
 *
 * A conferência dos bytes mágicos no envio é a outra metade da proteção.
 */
import { baixarDocumento } from '@/aplicacao/documentos/baixar-documento.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { falha } from '@/infraestrutura/http/resposta.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(_req, { params }) {
  try {
    const { nome, mimeType, conteudo } = await baixarDocumento(
      await usuarioAtual(), params.id,
    );

    return new Response(conteudo, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(conteudo.length),
        // filename* em UTF-8 para nome com acento não virar lixo no download.
        'Content-Disposition':
          `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        // Documento é dado de instituição: não pode ficar em cache de proxy.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return falha(e);
  }
}
