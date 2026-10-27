/**
 * CASOS DE USO — Logo da instituição.
 *
 * A logo é um documento como outro qualquer (tipo 'logo', visibilidade
 * 'interno'), e a instituição aponta para o vigente em logo_documento_id.
 * Trocar a logo não apaga a anterior: ela vira versão antiga, com histórico.
 *
 * O representante envia e troca a logo da própria instituição sem aprovação —
 * está na lista do que ele atualiza direto. Aparecer no painel público depende
 * de outra coisa: autoriza_divulgacao + autoriza_logo.
 */
import { createHash } from 'node:crypto';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { salvar, ler } from '@/infraestrutura/armazenamento/index.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, exigirInstituicaoPropria } from '@/aplicacao/guarda.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { pedirAnalise } from '@/aplicacao/documentos/enviar-documento.js';
import {
  conteudoBateComTipo, montarCaminho, tamanhoLegivel,
} from '@/dominio/arquivos.js';

/** Logo é imagem, e pequena: 2 MB cabe qualquer logo em boa resolução. */
export const LIMITE_LOGO_BYTES = 2 * 1024 * 1024;
export const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} instituicaoId
 * @param {{ nome: string, mime: string, conteudo: Buffer }|null} arquivo
 */
export async function definirLogo(usuario, instituicaoId, arquivo) {
  const u = exigir(usuario, 'instituicao', 'editar');
  exigir(u, 'documento', 'criar');
  exigirInstituicaoPropria(u, instituicaoId);

  if (!arquivo?.conteudo?.length) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Envie a imagem da logo no campo "arquivo".');
  }
  if (!TIPOS_LOGO.includes(arquivo.mime)) {
    throw new ErroDeNegocio('TIPO_NAO_PERMITIDO',
      'A logo precisa ser uma imagem PNG, JPEG ou WebP.', { tiposAceitos: TIPOS_LOGO });
  }
  if (arquivo.conteudo.length > LIMITE_LOGO_BYTES) {
    throw new ErroDeNegocio('ARQUIVO_GRANDE_DEMAIS',
      `A logo tem ${tamanhoLegivel(arquivo.conteudo.length)} e o limite é `
      + `${tamanhoLegivel(LIMITE_LOGO_BYTES)}.`,
      { limiteBytes: LIMITE_LOGO_BYTES, recebidoBytes: arquivo.conteudo.length });
  }
  if (!conteudoBateComTipo(arquivo.conteudo, arquivo.mime)) {
    throw new ErroDeNegocio('TIPO_NAO_PERMITIDO',
      'O conteúdo do arquivo não é a imagem que a extensão diz. Confira o arquivo.');
  }

  const emAnalise = !ehGestao(u.papel);

  return comUsuario(u.id, async (tx) => {
    const inst = await tx.consultaUm(
      'select id, logo_documento_id from instituicao where id = $1', [instituicaoId]);
    if (!inst) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    const anterior = inst.logo_documento_id
      ? await tx.consultaUm('select id, versao from documento where id = $1', [inst.logo_documento_id])
      : null;

    const { id: documentoId } = await tx.consultaUm('select gen_random_uuid() as id');
    const caminho = montarCaminho('instituicao', instituicaoId, documentoId, arquivo.nome);
    const checksum = createHash('sha256').update(arquivo.conteudo).digest('hex');

    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into documento
           (id, nome, tipo, storage_path, mime_type, tamanho_bytes, checksum_sha256,
            instituicao_id, enviado_por, visibilidade, versao, substitui_id, status_analise)
         values ($1, 'Logo', 'logo', $2, $3, $4, $5, $6, $7, 'interno', $8, $9, $10)
         returning id`,
        [documentoId, caminho, arquivo.mime, arquivo.conteudo.length, checksum,
          instituicaoId, u.id, anterior ? Number(anterior.versao) + 1 : 1,
          anterior?.id ?? null, emAnalise ? 'em_analise' : 'aprovado'],
      );
      if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite enviar a logo.');

      await salvar(tx, { documentoId, caminho, conteudo: arquivo.conteudo });

      // Representante: a logo nova fica em análise e a atual continua valendo
      // até a Diretoria aprovar (revisão do contrato do front, 26/10).
      if (emAnalise) {
        await pedirAnalise(tx, u, instituicaoId, documentoId, 'logo');
        return {
          instituicaoId, documentoId, status: 'em_analise',
          url: `/api/instituicoes/${instituicaoId}/logo`,
          versao: anterior ? Number(anterior.versao) + 1 : 1,
        };
      }

      const atualizada = await tx.consultaUm(
        `update instituicao set logo_documento_id = $2, updated_by = $3
          where id = $1 returning id`,
        [instituicaoId, documentoId, u.id],
      );
      if (!atualizada) {
        throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite alterar esta instituição.');
      }
    } catch (e) {
      if (e instanceof ErroDeNegocio) throw e;
      traduzirErroDoBanco(e);
    }

    return {
      instituicaoId,
      documentoId,
      status: 'aprovado',
      url: `/api/instituicoes/${instituicaoId}/logo`,
      versao: anterior ? Number(anterior.versao) + 1 : 1,
    };
  });
}

/**
 * Bytes da logo, para quem está logado. O painel público usa publico_logo().
 *
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} instituicaoId
 */
export async function baixarLogo(usuario, instituicaoId) {
  const u = exigir(usuario, 'instituicao', 'ver');

  return comUsuario(u.id, async (tx) => {
    // A logo é vista por todo membro ("consultar instituições e logos"), mesmo
    // sendo documento interno: por isso a leitura passa pela instituição, e
    // não pela política do documento.
    const d = await tx.consultaUm(
      `select d.id, d.storage_path, d.mime_type
         from instituicao i
         join documento d on d.id = i.logo_documento_id
        where i.id = $1`,
      [instituicaoId],
    );

    // Para o representante de outra instituição, a política de documento
    // esconde a linha. A logo continua aparecendo pela função do painel, se
    // ela foi autorizada; se não foi, é como se não existisse.
    if (!d) {
      const publica = await tx.consultaUm(
        'select mime_type, conteudo from publico_logo($1)', [instituicaoId]);
      if (!publica) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Esta instituição não tem logo.');
      return { mimeType: publica.mime_type, conteudo: Buffer.from(publica.conteudo) };
    }

    const conteudo = await ler(tx, { documentoId: d.id, caminho: d.storage_path });
    if (!conteudo) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Esta instituição não tem logo.');
    return { mimeType: d.mime_type, conteudo: Buffer.from(conteudo) };
  });
}
