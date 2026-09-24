/**
 * APRESENTAÇÃO — documentos (RF49, RF50).
 *
 *   GET  /api/documentos?instituicaoId=...   ou  ?reuniaoId=...
 *   POST /api/documentos   (multipart/form-data, ou JSON quando for só link)
 */
import { listarDocumentos } from '@/aplicacao/documentos/listar-documentos.js';
import { enviarDocumento } from '@/aplicacao/documentos/enviar-documento.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { ok, falha } from '@/infraestrutura/http/resposta.js';
import { LIMITE_BYTES } from '@/dominio/arquivos.js';

export const dynamic = 'force-dynamic';

/** @param {import('next/server').NextRequest} req */
export async function GET(req) {
  try {
    const filtros = Object.fromEntries(req.nextUrl.searchParams);
    return ok(await listarDocumentos(await usuarioAtual(), filtros));
  } catch (e) {
    return falha(e);
  }
}

/** @param {import('next/server').NextRequest} req */
export async function POST(req) {
  try {
    const usuario = await usuarioAtual();
    const tipoConteudo = req.headers.get('content-type') ?? '';

    // Só link: aceita JSON, que é mais simples para o front montar.
    if (tipoConteudo.includes('application/json')) {
      const corpo = await req.json().catch(() => null);
      return ok(await enviarDocumento(usuario, { campos: corpo, arquivo: null }), 201);
    }

    const formulario = await req.formData();
    const enviado = formulario.get('arquivo');

    /** @type {{nome: string, mime: string, conteudo: Buffer}|null} */
    let arquivo = null;
    if (enviado && typeof enviado !== 'string') {
// O tamanho é conferido de novo no caso de uso, sobre os bytes reais. Aqui é só
// para não carregar na memória um arquivo que já se sabe grande demais.
      if (enviado.size > LIMITE_BYTES) {
        const { ErroDeNegocio } = await import('@/dominio/erros.js');
        const { tamanhoLegivel } = await import('@/dominio/arquivos.js');
        throw new ErroDeNegocio('ARQUIVO_GRANDE_DEMAIS',
          `O arquivo tem ${tamanhoLegivel(enviado.size)} e o limite é `
          + `${tamanhoLegivel(LIMITE_BYTES)}.`,
          { limiteBytes: LIMITE_BYTES, recebidoBytes: enviado.size });
      }
      arquivo = {
        nome: enviado.name,
        mime: enviado.type || 'application/octet-stream',
        conteudo: Buffer.from(await enviado.arrayBuffer()),
      };
    }

    const campos = Object.fromEntries(
      [...formulario.entries()]
        .filter(([chave, valor]) => chave !== 'arquivo' && typeof valor === 'string'),
    );

    return ok(await enviarDocumento(usuario, { campos, arquivo }), 201);
  } catch (e) {
    return falha(e);
  }
}
