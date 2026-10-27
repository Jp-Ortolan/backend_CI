/**
 * GET /api/governanca/publico — o painel público do contrato, numa chamada só.
 *
 * Os dados vêm das mesmas funções publico_* do banco que servem /api/publico
 * (só o que pode ser público, sem dado pessoal). Aqui muda só o formato.
 */
import { consulta, consultaUm } from '@/infraestrutura/banco/consulta.js';

/** @param {string} base endereço desta API, para os links absolutos */
export async function painelGovernanca(base) {
  const ind = (await consultaUm('select publico_indicadores() as j'))?.j ?? {};
  const cfg = (await consultaUm('select publico_configuracao() as j'))?.j ?? {};
  const instituicoes = await consulta('select * from publico_instituicoes()');
  const diretoria = await consulta('select * from publico_diretoria()');
  const agenda = await consulta('select * from publico_agenda(current_date, null) limit 50');
  const documentos = await consulta('select * from publico_documentos()');

  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const canais = Array.isArray(cfg.canais_oficiais) ? cfg.canais_oficiais : [];

  return {
    // Indicador desconhecido é null, não zero (pedido do contrato).
    indicadores: {
      instituicoes: num(ind.instituicoesIntegrantes),
      reunioes: num(ind.reunioesRealizadas),
      eventos: num(ind.eventosRealizados),
      participacao: num(ind.percentualParticipacao),
    },
    instituicoes: instituicoes.map((i) => ({
      id: i.id,
      nome: i.nome_fantasia || i.nome,
      logoUrl: i.tem_logo ? `${base}/api/publico/instituicoes/${i.id}/logo` : null,
      tipo: i.tipo,
      vertente: i.vertente,
      area: i.area,
      cidade: i.cidade,
      // A função do banco já só devolve quem autorizou; o campo vai porque a
      // tela filtra por ele também.
      autorizaDivulgacao: true,
    })),
    diretoria: diretoria.map((d, n) => ({
      id: `diretoria-${n + 1}`, nome: d.nome, cargo: d.cargo_forum, instituicao: d.instituicao,
    })),
    calendario: agenda.map((a) => ({
      id: a.id,
      tipo: a.natureza,
      titulo: a.titulo,
      data: a.data,
      horaInicio: a.hora_inicio,
      local: [a.local, a.endereco].filter(Boolean).join(' · '),
      inscricaoUrl: a.inscricao_url,
    })),
    documentos: documentos.map((d) => ({
      titulo: d.nome,
      url: d.origem === 'link' ? d.url_externa : `${base}/api/publico/documentos/${d.id}`,
    })),
    canais: [
      ...canais.map((c) => ({ titulo: c.nome, url: c.url })),
      ...(cfg.linktree ? [{ titulo: 'Linktree', url: cfg.linktree }] : []),
    ],
    interesseUrl: cfg.link_manifestacao_interesse ?? null,
  };
}
