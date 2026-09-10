/**
 * CASO DE USO — Indicadores do dashboard (RF46).
 *
 * Alimenta os três cartões do topo, o gráfico de participação por instituição e
 * o bloco "Próximas reuniões".
 *
 * Nenhum número aqui é lido de coluna gravada: tudo vem das views vw_* (decisão
 * de arquitetura número 3). Indicador guardado é indicador que envelhece — na
 * primeira correção de presença o número da tela e o dado do banco divergem, e
 * ninguém descobre até alguém conferir na mão.
 *
 * A média de presença usa percentual_comparecimento, corrigido na migration
 * 002: representantes presentes ÷ vínculos vigentes na data da reunião,
 * convidado avulso fora da conta.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir } from '@/aplicacao/guarda.js';

/** Quantas instituições entram no ranking "Participação por instituição". */
const TOP_INSTITUICOES = 5;

/** Quantas reuniões futuras o bloco lista. */
const PROXIMAS_REUNIOES = 5;

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 */
export async function obterDashboard(usuario) {
  const u = exigir(usuario, 'indicador', 'ver');

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
              r.local, r.endereco, r.status,
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
      cartoes: {
        instituicoes: {
          ativas: Number(ind?.instituicoes_ativas ?? 0),
          inativas: Number(ind?.instituicoes_inativas ?? 0),
          emProcesso: Number(ind?.instituicoes_em_processo ?? 0),
        },
        representantesAtivos: Number(ind?.representantes_ativos ?? 0),
        reunioesRealizadas: Number(ind?.reunioes_realizadas ?? 0),
        reunioesAgendadas: Number(ind?.reunioes_agendadas ?? 0),
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
