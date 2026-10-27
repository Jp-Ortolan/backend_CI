/**
 * CASO DE USO — Anexar documento a uma instituição ou a uma reunião (RF49).
 *
 * Duas formas, e a tela oferece as duas:
 *   arquivo — os bytes vêm no multipart e ficam guardados no sistema
 *   link    — o documento mora no Drive e aqui fica só o endereço
 *
 * As duas geram a mesma linha de documento; muda `storage_path` (arquivo) ou
 * `url_externa` (link), e o banco garante que é sempre um só dos dois.
 */
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { salvar } from '@/infraestrutura/armazenamento/index.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, exigirInstituicaoPropria, validar } from '@/aplicacao/guarda.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { registrarSolicitacao } from '@/aplicacao/solicitacoes/criar-solicitacao.js';
import {
  LIMITE_BYTES, TIPOS_PERMITIDOS, conteudoBateComTipo,
  montarCaminho, sanitizarNome, tamanhoLegivel,
} from '@/dominio/arquivos.js';

/**
 * Tipos que o Fórum usa. O campo continua texto livre no banco (um tipo novo
 * não exige migration), mas estes têm significado para o sistema:
 * 'oficio' e 'termo_adesao' contam nas pendências do cadastro, 'logo' é a
 * imagem do painel público, 'ata' e 'convocacao' são da reunião.
 */
export const TIPOS_DOCUMENTO = [
  'oficio', 'termo_adesao', 'logo', 'convocacao', 'pauta', 'ata', 'foto',
  'material', 'relatorio', 'divulgacao', 'regimento', 'planejamento', 'outro',
];

const esquemaBase = z.object({
  instituicaoId: z.string().uuid().optional(),
  reuniaoId: z.string().uuid().optional(),
  nome: z.string().trim().max(200).optional(),
  descricao: z.string().trim().max(500).optional().transform((v) => (v || null)),
  tipo: z.string().trim().max(60).optional().transform((v) => (v || null)),
  urlExterna: z.string().trim().url('Informe uma URL válida.').optional(),
  // interno: gestão + a instituição; membros: todo logado; publico: painel.
  visibilidade: z.enum(['interno', 'membros', 'publico']).optional(),
  // Nova versão de um documento já enviado (ofício substituído, ata revisada).
  substituiId: z.string().uuid().optional(),
})
  .refine((d) => !(d.instituicaoId && d.reuniaoId), {
    message: 'O documento pertence a uma instituição OU a uma reunião, não às duas.',
    path: ['instituicaoId'],
  })
  .refine((d) => d.instituicaoId || d.reuniaoId || d.visibilidade === 'publico', {
    message: 'Informe a instituição ou a reunião do documento. Documento sem dono '
      + 'só existe como documento público do Fórum (Regimento, planejamento).',
    path: ['instituicaoId'],
  });

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {{ campos: unknown, arquivo?: { nome: string, mime: string, conteudo: Buffer }|null }} entrada
 */
export async function enviarDocumento(usuario, { campos, arquivo = null }) {
  const u = exigir(usuario, 'documento', 'criar');
  const d = validar(esquemaBase, campos ?? {});

  // "Enviar ofício e logo: apenas da própria instituição." O representante
  // não anexa a reunião nem publica no painel.
  if (!ehGestao(u.papel)) {
    if (!d.instituicaoId) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Seu perfil só anexa documentos à sua própria instituição.');
    }
    exigirInstituicaoPropria(u, d.instituicaoId);
    if (d.visibilidade && d.visibilidade !== 'interno') {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Documento enviado pela instituição fica restrito à Diretoria e à própria instituição.');
    }
  }

  // Padrão: material de reunião é para os membros; da instituição, interno.
  const visibilidade = d.visibilidade ?? (d.reuniaoId ? 'membros' : 'interno');
  // O que a instituição envia só vale depois que a Diretoria aprova (014).
  const statusAnalise = ehGestao(u.papel) ? 'aprovado' : 'em_analise';

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

  /** @type {'instituicao'|'reuniao'|'forum'} */
  const dono = d.instituicaoId ? 'instituicao' : d.reuniaoId ? 'reuniao' : 'forum';
  const donoId = d.instituicaoId ?? d.reuniaoId ?? 'forum';

  return comUsuario(u.id, async (tx) => {
    // O dono precisa existir: sem esta checagem o erro seria uma violação de
    // chave estrangeira, que não diz ao front qual campo está errado.
    if (dono !== 'forum') {
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
    }

    // Versão nova: herda dono e tipo da anterior e soma 1 na versão.
    let versao = 1;
    if (d.substituiId) {
      const anterior = await tx.consultaUm(
        `select id, versao, instituicao_id, reuniao_id from documento where id = $1`,
        [d.substituiId],
      );
      if (!anterior) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Documento a substituir não encontrado.');
      if ((anterior.instituicao_id ?? null) !== (d.instituicaoId ?? null)
        || (anterior.reuniao_id ?? null) !== (d.reuniaoId ?? null)) {
        throw new ErroDeNegocio('DADOS_INVALIDOS',
          'A nova versão precisa pertencer ao mesmo dono do documento original.');
      }
      versao = Number(anterior.versao) + 1;
    }

    const nomeVisivel = d.nome?.trim()
      || (arquivo ? sanitizarNome(arquivo.nome) : 'Documento');

    // ------------------------------------------------------------- só link
    if (!arquivo) {
      let linha;
      try {
        linha = await tx.consultaUm(
          `insert into documento
             (nome, descricao, tipo, url_externa, instituicao_id, reuniao_id, enviado_por,
              visibilidade, versao, substitui_id, status_analise)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           returning id, nome, created_at`,
          [nomeVisivel, d.descricao, d.tipo, d.urlExterna,
            d.instituicaoId ?? null, d.reuniaoId ?? null, u.id,
            visibilidade, versao, d.substituiId ?? null, statusAnalise],
        );
      } catch (e) {
        traduzirErroDoBanco(e);
      }
      if (!linha) {
        throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite anexar documentos.');
      }
      if (statusAnalise === 'em_analise') await pedirAnalise(tx, u, d.instituicaoId, linha.id, d.tipo);
      return {
        id: linha.id, nome: linha.nome, origem: 'link',
        urlExterna: d.urlExterna, enviadoEm: linha.created_at,
        visibilidade, versao, statusAnalise,
      };
    }

    // ---------------------------------------------------------- com arquivo
    const checksum = createHash('sha256').update(arquivo.conteudo).digest('hex');

// Mesmo arquivo e mesmo dono: devolve o que existe em vez de criar uma segunda
// cópia. Clicar duas vezes em enviar é a causa mais comum.
    const repetido = await tx.consultaUm(
      `select id, nome, created_at from documento
        where checksum_sha256 = $1
          and coalesce(instituicao_id::text, reuniao_id::text, 'forum') = $2`,
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
            checksum_sha256, instituicao_id, reuniao_id, enviado_por,
            visibilidade, versao, substitui_id, status_analise)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning id, nome, created_at`,
        [documentoId, nomeVisivel, d.descricao, d.tipo, caminho, arquivo.mime,
          arquivo.conteudo.length, checksum,
          d.instituicaoId ?? null, d.reuniaoId ?? null, u.id,
          visibilidade, versao, d.substituiId ?? null, statusAnalise],
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
    if (statusAnalise === 'em_analise') await pedirAnalise(tx, u, d.instituicaoId, documentoId, d.tipo);

    return {
      id: linha.id,
      nome: linha.nome,
      origem: 'arquivo',
      mimeType: arquivo.mime,
      tamanhoBytes: arquivo.conteudo.length,
      checksum,
      visibilidade,
      versao,
      statusAnalise,
      enviadoEm: linha.created_at,
      jaExistia: false,
    };
  });
}

/**
 * Documento enviado pela instituição vira um pedido de análise para a
 * Diretoria (solicitação aprovacao_documento). Aprovado, passa a valer.
 *
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {{ id: string }} u
 * @param {string} instituicaoId
 * @param {string} documentoId
 * @param {string|null} tipo
 */
export async function pedirAnalise(tx, u, instituicaoId, documentoId, tipo) {
  await registrarSolicitacao(tx, u, {
    instituicaoId, tipo: 'aprovacao_documento',
    dados: { documentoId, tipoDocumento: tipo ?? 'outro' },
    justificativa: `Documento enviado pela instituição: ${tipo ?? 'outro'}`,
    documentoId,
  });
}
