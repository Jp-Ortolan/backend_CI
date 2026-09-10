/**
 * CASO DE USO — Anexar documento a uma instituição ou a uma reunião (RF49).
 *
 * Duas formas, e a tela oferece as duas:
 *   arquivo — os bytes vêm no multipart e ficam guardados no sistema
 *   link    — o documento mora no Drive e aqui fica só o endereço
 *
 * O link existe porque o Centro já tem material no Drive e obrigar a reenviar
 * tudo seria trabalho manual sem ganho. As duas formas geram a mesma linha de
 * documento; o que muda é `storage_path` (arquivo) ou `url_externa` (link), e o
 * banco garante que é sempre exatamente um dos dois.
 */
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { salvar } from '@/infraestrutura/armazenamento/index.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import {
  LIMITE_BYTES, TIPOS_PERMITIDOS, conteudoBateComTipo,
  montarCaminho, sanitizarNome, tamanhoLegivel,
} from '@/dominio/arquivos.js';

const esquemaBase = z.object({
  instituicaoId: z.string().uuid().optional(),
  reuniaoId: z.string().uuid().optional(),
  nome: z.string().trim().max(200).optional(),
  descricao: z.string().trim().max(500).optional().transform((v) => (v || null)),
  tipo: z.string().trim().max(60).optional().transform((v) => (v || null)),
  urlExterna: z.string().trim().url('Informe uma URL válida.').optional(),
})
  .refine((d) => !!d.instituicaoId !== !!d.reuniaoId, {
    message: 'Informe a instituição OU a reunião a que o documento pertence.',
    path: ['instituicaoId'],
  });

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {{ campos: unknown, arquivo?: { nome: string, mime: string, conteudo: Buffer }|null }} entrada
 */
export async function enviarDocumento(usuario, { campos, arquivo = null }) {
  const u = exigir(usuario, 'documento', 'criar');
  const d = validar(esquemaBase, campos ?? {});

  if (!arquivo && !d.urlExterna) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      'Envie um arquivo ou informe o link do documento.');
  }
  if (arquivo && d.urlExterna) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      'Envie um arquivo ou informe um link, não os dois.');
  }

  // ------------------------------------------------------ conferência do arquivo
  if (arquivo) {
    if (!arquivo.conteudo?.length) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', 'O arquivo enviado está vazio.');
    }
    if (arquivo.conteudo.length > LIMITE_BYTES) {
      throw new ErroDeNegocio('ARQUIVO_GRANDE_DEMAIS',
        `O arquivo tem ${tamanhoLegivel(arquivo.conteudo.length)} e o limite é `
        + `${tamanhoLegivel(LIMITE_BYTES)}.`,
        { limiteBytes: LIMITE_BYTES, recebidoBytes: arquivo.conteudo.length });
    }
    if (!TIPOS_PERMITIDOS[arquivo.mime]) {
      throw new ErroDeNegocio('TIPO_NAO_PERMITIDO',
        'Este tipo de arquivo não é aceito. Envie PDF, imagem, documento do '
        + 'Office, texto ou CSV.',
        { tiposAceitos: Object.keys(TIPOS_PERMITIDOS) });
    }
    // O mime vem do navegador, que o deduz da extensão: é palpite, não prova.
    if (!conteudoBateComTipo(arquivo.conteudo, arquivo.mime)) {
      throw new ErroDeNegocio('TIPO_NAO_PERMITIDO',
        'O conteúdo do arquivo não corresponde à extensão. Confira se o arquivo '
        + 'não foi renomeado.');
    }
  }

  const dono = d.instituicaoId ? 'instituicao' : 'reuniao';
  const donoId = d.instituicaoId ?? d.reuniaoId;

  return comUsuario(u.id, async (tx) => {
    // O dono precisa existir: sem esta checagem o erro seria uma violação de
    // chave estrangeira, que não diz ao front qual campo está errado.
    const existe = await tx.consultaUm(
      dono === 'instituicao'
        ? 'select id, nome from instituicao where id = $1'
        : 'select id, titulo as nome from reuniao where id = $1',
      [donoId],
    );
    if (!existe) {
      throw new ErroDeNegocio('NAO_ENCONTRADO',
        dono === 'instituicao' ? 'Instituição não encontrada.' : 'Reunião não encontrada.');
    }

    const nomeVisivel = d.nome?.trim()
      || (arquivo ? sanitizarNome(arquivo.nome) : 'Documento');

    // ------------------------------------------------------------- só link
    if (!arquivo) {
      let linha;
      try {
        linha = await tx.consultaUm(
          `insert into documento
             (nome, descricao, tipo, url_externa, instituicao_id, reuniao_id, enviado_por)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id, nome, created_at`,
          [nomeVisivel, d.descricao, d.tipo, d.urlExterna,
            d.instituicaoId ?? null, d.reuniaoId ?? null, u.id],
        );
      } catch (e) {
        traduzirErroDoBanco(e);
      }
      if (!linha) {
        throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite anexar documentos.');
      }
      return {
        id: linha.id, nome: linha.nome, origem: 'link',
        urlExterna: d.urlExterna, enviadoEm: linha.created_at,
      };
    }

    // ---------------------------------------------------------- com arquivo
    const checksum = createHash('sha256').update(arquivo.conteudo).digest('hex');

    // Mesmo arquivo, mesmo dono, já anexado: devolver o que existe é mais útil
    // que criar uma segunda cópia idêntica que alguém vai ter que limpar
    // depois. Clicar duas vezes em "enviar" é a causa mais comum disso.
    const repetido = await tx.consultaUm(
      `select id, nome, created_at from documento
        where checksum_sha256 = $1
          and coalesce(instituicao_id, reuniao_id) = $2`,
      [checksum, donoId],
    );
    if (repetido) {
      return {
        id: repetido.id, nome: repetido.nome, origem: 'arquivo',
        enviadoEm: repetido.created_at, jaExistia: true,
      };
    }

    // O id sai antes para entrar no caminho do arquivo — assim o caminho é
    // único sem depender do nome, que pode repetir.
    const { id: documentoId } = await tx.consultaUm('select gen_random_uuid() as id');
    const caminho = montarCaminho(dono, donoId, documentoId, arquivo.nome);

    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into documento
           (id, nome, descricao, tipo, storage_path, mime_type, tamanho_bytes,
            checksum_sha256, instituicao_id, reuniao_id, enviado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id, nome, created_at`,
        [documentoId, nomeVisivel, d.descricao, d.tipo, caminho, arquivo.mime,
          arquivo.conteudo.length, checksum,
          d.instituicaoId ?? null, d.reuniaoId ?? null, u.id],
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite anexar documentos.');
    }

    // Mesma transação do metadado: ou as duas gravações passam, ou nenhuma.
    // Metadado sem conteúdo seria um botão "Baixar" que dá erro.
    await salvar(tx, { documentoId, caminho, conteudo: arquivo.conteudo });

    return {
      id: linha.id,
      nome: linha.nome,
      origem: 'arquivo',
      mimeType: arquivo.mime,
      tamanhoBytes: arquivo.conteudo.length,
      checksum,
      enviadoEm: linha.created_at,
      jaExistia: false,
    };
  });
}
