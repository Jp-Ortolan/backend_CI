/**
 * Documentos por escopo no contrato /api/governanca:
 *
 *   GET/POST /{escopo}/documentos
 *   escopo = minha-instituicao | instituicoes/:id | reunioes/:id | eventos/:id
 *
 * Upload: PDF, PNG ou JPEG até 10 MB, conferidos pelos BYTES (o MIME e o nome
 * vêm do navegador e não provam nada). Logo só PNG/JPEG. O que a instituição
 * envia entra "em análise" e só vale depois da aprovação da Diretoria.
 * Download sempre por link assinado e temporário (/arquivos/:token).
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao, pode } from '@/dominio/permissoes.js';
import { conteudoBateComTipo, tamanhoLegivel } from '@/dominio/arquivos.js';
import { exigir } from '@/aplicacao/guarda.js';
import { enviarDocumento } from '@/aplicacao/documentos/enviar-documento.js';
import { definirLogo } from '@/aplicacao/instituicoes/logo.js';
import { instituicaoDaSessao } from './minha-instituicao.js';
import { isoComFuso, linkDocumento } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */
/** @typedef {{ dono: 'instituicao'|'reuniao', id: string, natureza?: 'reuniao'|'evento' }} Escopo */

export const LIMITE_DOCUMENTO_BYTES = 10 * 1024 * 1024;
const MIMES = ['application/pdf', 'image/png', 'image/jpeg'];

/** Tipos aceitos em cada escopo (o contrato pede validar no servidor). */
export const TIPOS_POR_DONO = {
  instituicao: ['logo', 'oficio', 'termo_adesao', 'evidencia', 'foto', 'material'],
  reuniao: ['convocacao', 'ata', 'foto', 'material', 'evidencia'],
};
/** Um vigente por dono: o envio novo vira a versão seguinte. */
const VERSIONADOS = ['termo_adesao', 'ata', 'convocacao'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "minha-instituicao" | "instituicoes/:id" | "reunioes/:id" | "eventos/:id" → escopo.
 *
 * @param {Usuario} u
 * @param {string} tipo
 * @param {string|undefined} id
 * @returns {Escopo}
 */
export function resolverEscopo(u, tipo, id) {
  if (tipo === 'minha-instituicao') return { dono: 'instituicao', id: instituicaoDaSessao(u, null) };
  if (!id || !UUID.test(id)) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Registro não encontrado.');
  if (tipo === 'instituicoes') return { dono: 'instituicao', id };
  if (tipo === 'reunioes') return { dono: 'reuniao', id, natureza: 'reuniao' };
  if (tipo === 'eventos') return { dono: 'reuniao', id, natureza: 'evento' };
  throw new ErroDeNegocio('NAO_ENCONTRADO', 'Recurso não encontrado.');
}

/**
 * A atividade existe e é do tipo do caminho (reunião não responde como evento).
 *
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {Escopo} e
 */
export async function conferirEscopo(tx, e) {
  if (e.dono === 'instituicao') {
    const i = await tx.consultaUm('select id from instituicao where id = $1', [e.id]);
    if (!i) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');
    return;
  }
  const r = await tx.consultaUm('select id, natureza from reuniao where id = $1', [e.id]);
  if (!r || (e.natureza && r.natureza !== e.natureza)) {
    throw new ErroDeNegocio('NAO_ENCONTRADO', e.natureza === 'evento' ? 'Evento não encontrado.' : 'Reunião não encontrada.');
  }
}

/** @param {Usuario} u @param {Escopo} e */
function podeEnviar(u, e) {
  if (!pode(u.papel, 'documento', 'criar')) return false;
  if (ehGestao(u.papel)) return true;
  return e.dono === 'instituicao' && e.id === u.instituicaoId;
}

/**
 * @param {Usuario|null} usuario
 * @param {Escopo|((u: Usuario) => Escopo)} escopo
 * @param {string} base
 */
export async function listarDocumentosDoEscopo(usuario, escopo, base) {
  const u = exigir(usuario, 'documento', 'ver');
  const e = typeof escopo === 'function' ? escopo(u) : escopo;
  // Sem trava por instituição aqui: o RLS já entrega ao representante só os
  // documentos da instituição dele e os de visibilidade "membros"/"publico".
  // Os internos de outra instituição simplesmente não aparecem.

  return comUsuario(u.id, async (tx) => {
    await conferirEscopo(tx, e);
    const linhas = await tx.consulta(
      `select d.id, d.nome, d.tipo, d.versao, d.status_analise, d.substitui_id, d.url_externa,
              d.created_at, d.mime_type, d.tamanho_bytes, autor.nome as autor_nome
         from documento d
         left join vw_usuario_publico autor on autor.id = d.enviado_por
        where ${e.dono === 'instituicao' ? 'd.instituicao_id' : 'd.reuniao_id'} = $1
        order by d.created_at desc`, [e.id]);

    const porId = new Map(linhas.map((l) => [l.id, l]));
    const substituidos = new Set(linhas.map((l) => l.substitui_id).filter(Boolean));
    const link = (l) => l.url_externa ?? linkDocumento(base, l.id, u.id);

    const dados = linhas.filter((l) => !substituidos.has(l.id)).map((l) => {
      /** @type {any[]} */
      const versoes = [];
      for (let atual = l, n = 0; atual && n < 50; atual = porId.get(atual.substitui_id), n += 1) {
        versoes.push({
          id: atual.id,
          versaoArquivo: Number(atual.versao),
          status: atual.status_analise,
          enviadaEm: isoComFuso(atual.created_at),
          autorNome: atual.autor_nome ?? null,
          downloadUrl: link(atual),
        });
      }
      return {
        id: l.id,
        nome: l.nome,
        tipo: l.tipo ?? 'outro',
        versaoArquivo: Number(l.versao),
        status: l.status_analise,
        mimeType: l.mime_type,
        tamanhoBytes: l.tamanho_bytes === null ? null : Number(l.tamanho_bytes),
        enviadoEm: isoComFuso(l.created_at),
        autorNome: l.autor_nome ?? null,
        downloadUrl: link(l),
        versoes,
      };
    });

    return { podeEnviar: podeEnviar(u, e), tiposAceitos: TIPOS_POR_DONO[e.dono], dados };
  });
}

/**
 * @param {Usuario|null} usuario
 * @param {Escopo|((u: Usuario) => Escopo)} escopo
 * @param {{ tipo: string, nome?: string, descricao?: string }} campos
 * @param {{ nome: string, mime: string, conteudo: Buffer }|null} arquivo
 */
export async function enviarDocumentoDoEscopo(usuario, escopo, campos, arquivo) {
  const u = exigir(usuario, 'documento', 'criar');
  const e = typeof escopo === 'function' ? escopo(u) : escopo;
  if (!podeEnviar(u, e)) {
    throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não envia documentos para este registro.');
  }

  const tipo = String(campos?.tipo ?? '').trim();
  if (!TIPOS_POR_DONO[e.dono].includes(tipo)) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      `Tipo de documento inválido aqui. Aceitos: ${TIPOS_POR_DONO[e.dono].join(', ')}.`,
      { campos: [{ campo: 'tipo', mensagem: 'Selecione um tipo válido.' }] });
  }
  if (!arquivo?.conteudo?.length) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Selecione o arquivo.',
      { campos: [{ campo: 'arquivo', mensagem: 'Selecione o arquivo.' }] });
  }
  if (arquivo.conteudo.length > LIMITE_DOCUMENTO_BYTES) {
    throw new ErroDeNegocio('ARQUIVO_GRANDE_DEMAIS',
      `O arquivo tem ${tamanhoLegivel(arquivo.conteudo.length)} e o limite é ${tamanhoLegivel(LIMITE_DOCUMENTO_BYTES)}.`,
      { limiteBytes: LIMITE_DOCUMENTO_BYTES, recebidoBytes: arquivo.conteudo.length });
  }
  // O tipo é o que os bytes dizem, não o que o navegador declarou.
  const aceitos = tipo === 'logo' ? ['image/png', 'image/jpeg'] : MIMES;
  const mime = aceitos.find((m) => conteudoBateComTipo(arquivo.conteudo, m));
  if (!mime) {
    throw new ErroDeNegocio('TIPO_NAO_PERMITIDO',
      tipo === 'logo' ? 'A logo precisa ser uma imagem PNG ou JPEG.' : 'Envie um arquivo PDF, PNG ou JPEG.',
      { tiposAceitos: aceitos });
  }
  const real = { ...arquivo, mime };

  if (tipo === 'logo') {
    const r = await definirLogo(u, e.id, real);
    return { documento: { id: r.documentoId, status: r.status, versaoArquivo: r.versao } };
  }

  // Nova versão do documento vigente do mesmo tipo (termo, ata, convocação).
  let substituiId;
  if (VERSIONADOS.includes(tipo)) {
    const vigente = await comUsuario(u.id, (tx) => tx.consultaUm(
      `select d.id from documento d
        where ${e.dono === 'instituicao' ? 'd.instituicao_id' : 'd.reuniao_id'} = $1 and d.tipo = $2
          and d.status_analise <> 'recusado'
          and not exists (select 1 from documento n where n.substitui_id = d.id)
        order by d.created_at desc limit 1`, [e.id, tipo]));
    substituiId = vigente?.id;
  }

  const r = await enviarDocumento(u, {
    campos: {
      ...(e.dono === 'instituicao' ? { instituicaoId: e.id } : { reuniaoId: e.id }),
      tipo,
      ...(campos.nome ? { nome: campos.nome } : {}),
      ...(campos.descricao ? { descricao: campos.descricao } : {}),
      ...(substituiId ? { substituiId } : {}),
    },
    arquivo: real,
  });

  let status = r.statusAnalise;
  if (!status) {
    // Mesmo arquivo enviado de novo: devolve o que já existia.
    const d = await comUsuario(u.id, (tx) => tx.consultaUm('select status_analise from documento where id = $1', [r.id]));
    status = d?.status_analise ?? 'aprovado';
  }
  return { documento: { id: r.id, status, versaoArquivo: r.versao ?? null, jaExistia: !!r.jaExistia } };
}
