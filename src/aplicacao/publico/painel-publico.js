/**
 * CASOS DE USO — Painel público, sem login (revisão de outubro).
 *
 * Tudo aqui passa pelas funções publico_* do banco (migration 011), que
 * devolvem só o que pode ser público: números agregados, instituições que
 * AUTORIZARAM a divulgação, logos autorizadas, agenda marcada como pública,
 * composição da Diretoria e documentos públicos. Nenhuma devolve CPF, e-mail
 * ou telefone de pessoa, e nenhum percentual é por pessoa.
 *
 * Não existe usuário aqui, e por isso não existe comUsuario(): as tabelas,
 * com o RLS, continuam devolvendo zero linhas para quem não tem login.
 */
import { z } from 'zod';
import { consulta, consultaUm } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { validar } from '@/aplicacao/guarda.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** @param {any} l */
const atividade = (l) => ({
  id: l.id,
  titulo: l.titulo,
  natureza: l.natureza,
  tipo: l.tipo,
  numero: l.numero,
  data: l.data,
  horaInicio: l.hora_inicio,
  horaFim: l.hora_fim,
  local: l.local,
  endereco: l.endereco,
  modalidade: l.modalidade,
  organizacaoResponsavel: l.organizacao_responsavel,
  eventoProprio: l.evento_proprio,
  inscricaoUrl: l.inscricao_url,
  descricao: l.descricao,
  status: l.status,
});

/** A página inicial do painel numa ida só. */
export async function painelPublico() {
  const ind = await consultaUm('select publico_indicadores() as j');
  const cfg = await consultaUm('select publico_configuracao() as j');
  const diretoria = await consulta('select * from publico_diretoria()');
  const agenda = await consulta('select * from publico_agenda(current_date, null) limit 10');

  const config = cfg?.j ?? {};
  return {
    indicadores: ind?.j ?? {},
    diretoria: diretoria.map((d) => ({ nome: d.nome, cargo: d.cargo_forum, instituicao: d.instituicao })),
    proximasAtividades: agenda.map(atividade),
    linkManifestacaoInteresse: config.link_manifestacao_interesse ?? null,
    linktree: config.linktree ?? null,
    canaisOficiais: Array.isArray(config.canais_oficiais) ? config.canais_oficiais : [],
  };
}

export const esquemaFiltroPublico = z.object({
  tipo: z.coerce.number().int().positive().optional(),
  vertente: z.coerce.number().int().positive().optional(),
  area: z.coerce.number().int().positive().optional(),
  busca: z.string().trim().max(120).optional(),
});

/** @param {unknown} filtros */
export async function instituicoesPublicas(filtros) {
  const f = validar(esquemaFiltroPublico, filtros ?? {});
  const linhas = await consulta(
    'select * from publico_instituicoes($1, $2, $3, $4)',
    [f.tipo ?? null, f.vertente ?? null, f.area ?? null, f.busca || null],
  );
  const opcoes = await consultaUm('select publico_filtros() as j');

  return {
    dados: linhas.map((l) => ({
      id: l.id,
      nome: l.nome,
      nomeFantasia: l.nome_fantasia,
      tipo: l.tipo,
      vertente: l.vertente,
      area: l.area,
      cidade: l.cidade,
      uf: l.uf,
      site: l.site,
      descricao: l.descricao,
      redesSociais: l.redes_sociais ?? {},
      integranteDesde: l.data_entrada,
      logoUrl: l.tem_logo ? `/api/publico/instituicoes/${l.id}/logo` : null,
    })),
    total: linhas.length,
    filtros: opcoes?.j ?? {},
  };
}

/** @param {string} instituicaoId */
export async function logoPublica(instituicaoId) {
  if (!z.string().uuid().safeParse(instituicaoId).success) {
    throw new ErroDeNegocio('NAO_ENCONTRADO', 'Logo não encontrada.');
  }
  const l = await consultaUm('select * from publico_logo($1)', [instituicaoId]);
  if (!l) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Logo não encontrada.');
  return { mimeType: l.mime_type, conteudo: Buffer.from(l.conteudo) };
}

const esquemaAgenda = z.object({
  de: z.string().regex(DATA).optional(),
  ate: z.string().regex(DATA).optional(),
});

/** Calendário unificado: reuniões e eventos marcados como públicos. */
export async function agendaPublica(filtros) {
  const f = validar(esquemaAgenda, filtros ?? {});
  const linhas = await consulta('select * from publico_agenda($1, $2)', [f.de ?? null, f.ate ?? null]);
  return { dados: linhas.map(atividade) };
}

export async function documentosPublicos() {
  const linhas = await consulta('select * from publico_documentos()');
  return {
    dados: linhas.map((d) => ({
      id: d.id,
      nome: d.nome,
      descricao: d.descricao,
      tipo: d.tipo,
      origem: d.origem,
      urlExterna: d.url_externa,
      url: d.origem === 'arquivo' ? `/api/publico/documentos/${d.id}` : d.url_externa,
      mimeType: d.mime_type,
      tamanhoBytes: d.tamanho_bytes === null ? null : Number(d.tamanho_bytes),
      versao: Number(d.versao),
      publicadoEm: d.publicado_em,
    })),
  };
}

/** @param {string} id */
export async function documentoPublico(id) {
  if (!z.string().uuid().safeParse(id).success) {
    throw new ErroDeNegocio('NAO_ENCONTRADO', 'Documento não encontrado.');
  }
  const d = await consultaUm('select * from publico_documento_conteudo($1)', [id]);
  if (!d) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Documento não encontrado.');
  return { nome: d.nome, mimeType: d.mime_type ?? 'application/octet-stream', conteudo: Buffer.from(d.conteudo) };
}
