/**
 * APRESENTAÇÃO — logo da instituição.
 *
 *   GET  /api/instituicoes/:id/logo     a imagem (para <img src>)
 *   POST /api/instituicoes/:id/logo     multipart/form-data, campo "arquivo"
 *
 * O representante envia e troca a logo da própria instituição sem aprovação.
 */
import { definirLogo, baixarLogo, LIMITE_LOGO_BYTES } from '@/aplicacao/instituicoes/logo.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { respostaDeArquivo } from '@/infraestrutura/http/arquivo.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

export const dynamic = 'force-dynamic';

/**
 * @param {import('next/server').NextRequest} _req
 * @param {{ params: { id: string } }} contexto
 */
export async function GET(_req, { params }) {
  try {
    const { mimeType, conteudo } = await baixarLogo(await usuarioAtual(), params.id);
    return respostaDeArquivo({ nome: 'logo', mimeType, conteudo, inline: true });
  } catch (e) {
    return falha(e);
  }
}

/**
 * @param {import('next/server').NextRequest} req
 * @param {{ params: { id: string } }} contexto
 */
export async function POST(req, { params }) {
  try {
    const usuario = await usuarioAtual();
    const formulario = await req.formData().catch(() => null);
    const enviado = formulario?.get('arquivo');
    if (!enviado || typeof enviado === 'string') {
      throw new ErroDeNegocio('DADOS_INVALIDOS', 'Envie a imagem da logo no campo "arquivo".');
    }
    if (enviado.size > LIMITE_LOGO_BYTES) {
      throw new ErroDeNegocio('ARQUIVO_GRANDE_DEMAIS', 'A logo pode ter no máximo 2 MB.',
        { limiteBytes: LIMITE_LOGO_BYTES, recebidoBytes: enviado.size });
    }
    const arquivo = {
      nome: enviado.name,
      mime: enviado.type || 'application/octet-stream',
      conteudo: Buffer.from(await enviado.arrayBuffer()),
    };
    return ok(await definirLogo(usuario, params.id, arquivo), 201);
  } catch (e) {
    return falha(e);
  }
}
