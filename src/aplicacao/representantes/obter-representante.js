/**
 * CASO DE USO — Detalhe e histórico do representante (RF41, RF44).
 *
 * O histórico é por VÍNCULO, não por pessoa: quem mudou de instituição tem duas
 * linhas de participação, cada uma contando só as reuniões do seu período.
 * Quem faz esse corte é a view vw_participacao_representante.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id  id da pessoa
 */
export async function obterRepresentante(usuario, id) {
  const u = exigir(usuario, 'representante', 'ver');

  return comUsuario(u.id, async (tx) => {
    const p = await tx.consultaUm(
      'select id, nome, email, telefone, cpf, observacoes, created_at, updated_at from pessoa where id = $1',
      [id],
    );
    if (!p) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Representante não encontrado.');

    const vinculos = await tx.consulta(
      `select v.id, v.cargo, v.status, v.data_inicio, v.data_fim, v.observacoes,
              i.id as instituicao_id, i.nome as instituicao, i.status as status_instituicao
         from vinculo v
         join instituicao i on i.id = v.instituicao_id
        where v.pessoa_id = $1
        order by (v.status = 'ativo') desc, v.data_inicio desc`,
      [id],
    );

    // Uma linha por instituição pela qual a pessoa passou.
    const participacao = await tx.consulta(
      `select instituicao_id, instituicao, reunioes_esperadas, presencas,
              ausencias, percentual_participacao, ultima_participacao
         from vw_participacao_representante
        where pessoa_id = $1
        order by percentual_participacao desc nulls last, instituicao`,
      [id],
    );

    // A linha do tempo que a tela de histórico mostra: cada reunião em que a
    // pessoa era esperada, com o que aconteceu.
    const reunioes = await tx.consulta(
      `select r.id as reuniao_id, r.titulo, r.data, r.status as status_reuniao,
              i.nome as instituicao,
              pr.status as status_presenca, pr.horario_checkin, pr.tipo,
              c.status as status_confirmacao
         from vw_reuniao_esperada e
         join reuniao r     on r.id = e.reuniao_id
         join instituicao i on i.id = e.instituicao_id
         left join presenca pr
                on pr.reuniao_id = e.reuniao_id and pr.pessoa_id = e.pessoa_id
         left join reuniao_convite c
                on c.reuniao_id = e.reuniao_id and c.vinculo_id = e.vinculo_id
        where e.pessoa_id = $1
        order by r.data desc
        limit 100`,
      [id],
    );

    const totais = participacao.reduce(
      (acc, l) => ({
        esperadas: acc.esperadas + Number(l.reunioes_esperadas ?? 0),
        presencas: acc.presencas + Number(l.presencas ?? 0),
        ausencias: acc.ausencias + Number(l.ausencias ?? 0),
      }),
      { esperadas: 0, presencas: 0, ausencias: 0 },
    );

    return {
      id: p.id,
      nome: p.nome,
      cpf: p.cpf,
      email: p.email,
      telefone: p.telefone,
      observacoes: p.observacoes,

      vinculos: vinculos.map((v) => ({
        id: v.id,
        instituicaoId: v.instituicao_id,
        instituicao: v.instituicao,
        statusInstituicao: v.status_instituicao,
        cargo: v.cargo,
        status: v.status,
        dataInicio: v.data_inicio,
        dataFim: v.data_fim,
        observacoes: v.observacoes,
      })),
      vinculoAtual: vinculos.find((v) => v.status === 'ativo')
        ? {
          id: vinculos.find((v) => v.status === 'ativo').id,
          instituicao: vinculos.find((v) => v.status === 'ativo').instituicao,
          cargo: vinculos.find((v) => v.status === 'ativo').cargo,
        }
        : null,

      participacaoPorInstituicao: participacao.map((l) => ({
        instituicaoId: l.instituicao_id,
        instituicao: l.instituicao,
        reunioesEsperadas: Number(l.reunioes_esperadas ?? 0),
        presencas: Number(l.presencas ?? 0),
        ausencias: Number(l.ausencias ?? 0),
        percentual: l.percentual_participacao === null
          ? null : Number(l.percentual_participacao),
        ultimaParticipacao: l.ultima_participacao,
      })),

      resumo: {
        reunioesEsperadas: totais.esperadas,
        presencas: totais.presencas,
        ausencias: totais.ausencias,
        // Percentual geral só existe se houve reunião esperada. Sem isso a tela
        // mostraria 0%, que é uma acusação, e não a ausência de dado.
        percentual: totais.esperadas > 0
          ? Number(((100 * totais.presencas) / totais.esperadas).toFixed(1))
          : null,
      },

      historico: reunioes.map((r) => ({
        reuniaoId: r.reuniao_id,
        titulo: r.titulo,
        data: r.data,
        statusReuniao: r.status_reuniao,
        instituicao: r.instituicao,
        statusConfirmacao: r.status_confirmacao,
        statusPresenca: r.status_presenca,
        horarioCheckin: r.horario_checkin,
      })),

      cadastro: { criadoEm: p.created_at, atualizadoEm: p.updated_at },
    };
  });
}
