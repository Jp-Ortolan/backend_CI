/**
 * CASO DE USO — Indicadores do dashboard (RF46).
 *
 * Cartões do topo, gráfico de participação por instituição e próximas reuniões.
 * Nenhum número sai de coluna gravada: tudo vem das views vw_* (decisão 3).
 * A média usa percentual_comparecimento (migration 002): representantes
 * presentes ÷ vínculos vigentes na data, convidado avulso fora da conta.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir } from '@/aplicacao/guarda.js';
import { ehGestao } from '@/dominio/permissoes.js';

/** Quantas instituições entram no ranking "Participação por instituição". */
const TOP_INSTITUICOES = 5;

/** Quantas reuniões futuras o bloco lista. */
const PROXIMAS_REUNIOES = 5;

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 */
export async function obterDashboard(usuario) {
  const u = exigir(usuario, 'indicador', 'ver');

  // O representante vê o dashboard GERAL do Fórum ("Visualizar dashboard
  // geral: ✅") — só que, com o RLS recortando as tabelas pela instituição
  // dele, as views dariam números só da instituição. Os números gerais vêm da
  // mesma função do painel público (agregados, sem nome de ninguém), e ao lado
  // vai o recorte da instituição dele.
  if (!ehGestao(u.papel)) return dashboardDoRepresentante(u);

  return comUsuario(u.id, async (tx) => {
    const ind = await tx.consultaUm('select * from vw_dashboard');

    // Evolução da participação, mês a mês, nos últimos 12 meses. É a linha do
    // gráfico "Evolução da participação".
    const evolucao = await tx.consulta(
      `select to_char(date_trunc('month', data), 'YYYY-MM') as mes,
              round(avg(percentual_comparecimento), 1) as percentual,
              count(*) as reunioes
         from vw_resumo_reuniao
        where status = 'encerrada'
          and data >= (current_date - interval '12 months')
        group by date_trunc('month', data)
        order by date_trunc('month', data)`,
    );

    const porInstituicao = await tx.consulta(
      `select instituicao_id, instituicao, percentual_participacao,
              reunioes_esperadas, reunioes_com_presenca
         from vw_participacao_instituicao
        where status = 'ativa'
          -- Instituição sem nenhuma reunião esperada não tem percentual: ela
          -- entraria no ranking como null e apareceria como barra vazia,
          -- sugerindo ausência onde não houve nem oportunidade de comparecer.
          and reunioes_esperadas > 0
        order by percentual_participacao desc nulls last, instituicao
        limit $1`,
      [TOP_INSTITUICOES],
    );

    const proximas = await tx.consulta(
      `select r.id, r.titulo, r.descricao, r.data, r.hora_inicio,
              r.local, r.endereco, r.status, r.natureza,
              v.convites_enviados, v.confirmados
         from reuniao r
         join vw_resumo_reuniao v on v.reuniao_id = r.id
        where r.status in ('agendada', 'em_andamento')
          and r.data >= current_date
        order by r.data, r.hora_inicio nulls last
        limit $1`,
      [PROXIMAS_REUNIOES],
    );

    return {
      escopo: 'tudo',
      cartoes: {
        instituicoes: {
          ativas: Number(ind?.instituicoes_ativas ?? 0),
          inativas: Number(ind?.instituicoes_inativas ?? 0),
          emProcesso: Number(ind?.instituicoes_em_processo ?? 0),
        },
        representantesAtivos: Number(ind?.representantes_ativos ?? 0),
        reunioesRealizadas: Number(ind?.reunioes_realizadas ?? 0),
        reunioesAgendadas: Number(ind?.reunioes_agendadas ?? 0),
        eventosRealizados: Number(ind?.eventos_realizados ?? 0),
        solicitacoesPendentes: Number(ind?.solicitacoes_pendentes ?? 0),
        // Sem reunião encerrada ainda não existe média. null e não 0, para a
        // tela poder mostrar "—" em vez de anunciar 0% de presença.
        mediaPresenca: ind?.media_presenca ?? null,
      },

      evolucaoParticipacao: evolucao.map((l) => ({
        mes: l.mes,
        percentual: l.percentual === null ? null : Number(l.percentual),
        reunioes: Number(l.reunioes),
      })),

      participacaoPorInstituicao: porInstituicao.map((l) => ({
        instituicaoId: l.instituicao_id,
        instituicao: l.instituicao,
        percentual: l.percentual_participacao === null
          ? null : Number(l.percentual_participacao),
        reunioesEsperadas: Number(l.reunioes_esperadas),
        reunioesComPresenca: Number(l.reunioes_com_presenca),
      })),

      proximasReunioes: proximas.map((l) => ({
        id: l.id,
        titulo: l.titulo,
        natureza: l.natureza,
        descricao: l.descricao,
        data: l.data,
        horaInicio: l.hora_inicio,
        local: l.local,
        endereco: l.endereco,
        status: l.status,
        convitesEnviados: Number(l.convites_enviados),
        confirmados: Number(l.confirmados),
      })),
    };
  });
}

/**
 * Dashboard do representante: números gerais do Fórum + a instituição dele.
 *
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} u
 */
async function dashboardDoRepresentante(u) {
  return comUsuario(u.id, async (tx) => {
    const geral = (await tx.consultaUm('select publico_indicadores() as j'))?.j ?? {};

    const minha = u.instituicaoId
      ? await tx.consultaUm(
        `select i.id, i.nome, i.status, w.reunioes_esperadas, w.reunioes_com_presenca,
                w.percentual_participacao, w.representantes_ativos,
                (select count(*) from solicitacao s
                  where s.instituicao_id = i.id and s.status = 'pendente') as solicitacoes_pendentes
           from instituicao i
           left join vw_participacao_instituicao w on w.instituicao_id = i.id
          where i.id = $1`, [u.instituicaoId])
      : null;

    const proximas = await tx.consulta(
      `select r.id, r.titulo, r.natureza, r.data, r.hora_inicio, r.local, r.endereco, r.status,
              (select c.status from reuniao_convite c
                where c.reuniao_id = r.id and c.instituicao_id = $1 limit 1) as minha_confirmacao
         from reuniao r
        where r.status in ('agendada', 'em_andamento') and r.data >= current_date
        order by r.data, r.hora_inicio nulls last
        limit $2`,
      [u.instituicaoId ?? null, PROXIMAS_REUNIOES],
    );

    const pct = minha?.percentual_participacao;

    return {
      escopo: 'instituicao',
      // O mesmo formato do dashboard da gestão, para a tela legada (que lê
      // `cartoes`) funcionar sem mudança. Os números são os GERAIS do Fórum;
      // o recorte da instituição vem em participacaoPorInstituicao.
      cartoes: {
        instituicoes: { ativas: Number(geral.instituicoesIntegrantes ?? 0), inativas: null, emProcesso: null },
        representantesAtivos: Number(geral.representantesAtivos ?? 0),
        reunioesRealizadas: Number(geral.reunioesRealizadas ?? 0),
        reunioesAgendadas: proximas.length,
        eventosRealizados: Number(geral.eventosRealizados ?? 0),
        mediaPresenca: geral.percentualParticipacao ?? null,
      },
      evolucaoParticipacao: [],
      participacaoPorInstituicao: minha ? [{
        instituicaoId: minha.id,
        instituicao: minha.nome,
        percentual: pct === null || pct === undefined ? null : Number(pct),
        reunioesEsperadas: Number(minha.reunioes_esperadas ?? 0),
        reunioesComPresenca: Number(minha.reunioes_com_presenca ?? 0),
      }] : [],
      geral,
      minhaInstituicao: minha
        ? {
          id: minha.id,
          nome: minha.nome,
          status: minha.status,
          representantesAtivos: Number(minha.representantes_ativos ?? 0),
          reunioesEsperadas: Number(minha.reunioes_esperadas ?? 0),
          reunioesComPresenca: Number(minha.reunioes_com_presenca ?? 0),
          percentualParticipacao: minha.percentual_participacao === null
            || minha.percentual_participacao === undefined
            ? null : Number(minha.percentual_participacao),
          solicitacoesPendentes: Number(minha.solicitacoes_pendentes ?? 0),
        }
        : null,
      proximasReunioes: proximas.map((l) => ({
        id: l.id,
        titulo: l.titulo,
        natureza: l.natureza,
        data: l.data,
        horaInicio: l.hora_inicio,
        local: l.local,
        endereco: l.endereco,
        status: l.status,
        minhaConfirmacao: l.minha_confirmacao,
      })),
    };
  });
}
