/**
 * CASO DE USO — Histórico de participação da instituição (RF42, RF45).
 *
 * O detalhe da instituição já traz os números do resumo. Aqui é a linha do
 * tempo: reunião a reunião, quem da instituição era esperado e quem apareceu.
 *
 * A diferença que importa: uma instituição pode ter vários representantes na
 * mesma reunião. "A instituição participou" quer dizer que PELO MENOS UM
 * apareceu — contar por pessoa faria uma instituição com cinco representantes
 * parecer pior que uma com um só, quando as duas mandaram alguém.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaHistorico = z.object({
  de: z.string().regex(DATA).optional(),
  ate: z.string().regex(DATA).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} instituicaoId
 * @param {unknown} filtros
 */
export async function obterHistoricoInstituicao(usuario, instituicaoId, filtros) {
  const u = exigir(usuario, 'instituicao', 'ver');
  const f = validar(esquemaHistorico, filtros ?? {});

  /** @type {unknown[]} */
  const valores = [instituicaoId];
  let periodo = '';
  if (f.de) { valores.push(f.de); periodo += ` and r.data >= $${valores.length}::date`; }
  if (f.ate) { valores.push(f.ate); periodo += ` and r.data <= $${valores.length}::date`; }

  valores.push(f.porPagina, (f.pagina - 1) * f.porPagina);

  return comUsuario(u.id, async (tx) => {
    const inst = await tx.consultaUm(
      'select id, nome, status from instituicao where id = $1', [instituicaoId],
    );
    if (!inst) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    const linhas = await tx.consulta(
      `select r.id as reuniao_id, r.titulo, r.data, r.status as status_reuniao,
              -- Quantos vínculos da instituição eram esperados nesta reunião.
              (select count(*) from vinculo v
                where v.instituicao_id = $1
                  and v.data_inicio <= r.data
                  and (v.data_fim is null or v.data_fim >= r.data)) as esperados,
              count(*) filter (where p.status = 'presente')  as presentes,
              count(*) filter (where p.status = 'ausente')   as ausentes,
              count(*) filter (where p.status = 'justificado') as justificados,
              min(p.horario_checkin) filter (where p.status = 'presente')
                as primeiro_checkin,
              -- Quem foi, com nome e cargo da época.
              coalesce(
                json_agg(json_build_object(
                    'pessoaId', pe.id, 'nome', pe.nome,
                    'cargo', p.cargo_no_momento, 'status', p.status,
                    'horarioCheckin', p.horario_checkin)
                  order by pe.nome)
                filter (where p.id is not null), '[]'::json) as participantes
         from reuniao r
         left join presenca p on p.reuniao_id = r.id and p.instituicao_id = $1
         left join pessoa   pe on pe.id = p.pessoa_id
        where r.status = 'encerrada'
          -- Só reuniões em que a instituição tinha alguém vinculado. Reunião de
          -- antes da entrada dela no ecossistema não é ausência: é reunião que
          -- não lhe dizia respeito.
          and exists (select 1 from vinculo v
                       where v.instituicao_id = $1
                         and v.data_inicio <= r.data
                         and (v.data_fim is null or v.data_fim >= r.data))
          ${periodo}
        group by r.id, r.titulo, r.data, r.status
        order by r.data desc
        limit $${valores.length - 1} offset $${valores.length}`,
      valores,
    );

    const resumo = await tx.consultaUm(
      `select reunioes_esperadas, reunioes_com_presenca, percentual_participacao,
              representantes_ativos
         from vw_participacao_instituicao where instituicao_id = $1`,
      [instituicaoId],
    );

    return {
      instituicao: { id: inst.id, nome: inst.nome, status: inst.status },

      resumo: {
        reunioesEsperadas: Number(resumo?.reunioes_esperadas ?? 0),
        reunioesComPresenca: Number(resumo?.reunioes_com_presenca ?? 0),
        representantesAtivos: Number(resumo?.representantes_ativos ?? 0),
        // null quando não houve reunião esperada — 0% seria acusar de faltar
        // quem nunca foi chamado.
        percentual: resumo?.percentual_participacao ?? null,
      },

      historico: linhas.map((l) => ({
        reuniaoId: l.reuniao_id,
        titulo: l.titulo,
        data: l.data,
        statusReuniao: l.status_reuniao,
        esperados: Number(l.esperados),
        presentes: Number(l.presentes),
        ausentes: Number(l.ausentes),
        justificados: Number(l.justificados),
        // A instituição compareceu se ao menos um representante apareceu.
        compareceu: Number(l.presentes) > 0,
        primeiroCheckin: l.primeiro_checkin,
        participantes: l.participantes,
      })),

      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  });
}
