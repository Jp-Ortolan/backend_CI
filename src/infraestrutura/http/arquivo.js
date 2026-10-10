/**
 * Resposta HTTP com arquivo: download de documento, logo, exportação CSV.
 *
 * Os cabeçalhos de segurança são os mesmos do download de documento (ver
 * app/api/documentos/[id]/conteudo): o conteúdo veio de um usuário e é servido
 * do domínio do sistema.
 *
 *   inline   — imagem que a tela mostra direto (<img src>). Só para imagem já
 *              conferida pelos bytes mágicos no envio.
 *   publico  — pode ficar em cache de navegador e de CDN (logo autorizada,
 *              documento público). O resto é sempre private, no-store.
 */

/**
 * @param {{ nome: string, mimeType: string, conteudo: Buffer|Uint8Array|string,
 *           inline?: boolean, publico?: boolean }} arquivo
 * @returns {Response}
 */
export function respostaDeArquivo({ nome, mimeType, conteudo, inline = false, publico = false }) {
  const corpo = typeof conteudo === 'string' ? Buffer.from(conteudo, 'utf8') : Buffer.from(conteudo);
  const disposicao = inline ? 'inline' : 'attachment';

  return new Response(corpo, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(corpo.length),
      // filename* em UTF-8 para nome com acento não virar lixo no download.
      'Content-Disposition':
        `${disposicao}; filename="${nome.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': publico ? 'public, max-age=3600' : 'private, no-store',
    },
  });
}
