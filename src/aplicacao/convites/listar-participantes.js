/**
 * CASO DE USO — Lista de presença da reunião (RF35, RF36).
 *
 * Convidados e presentes na mesma lista, com os filtros da tela:
 * presente / ausente / convidado / por instituição.
 *
 * A junção mora em vw_reuniao_participante (migration 003), com full join: um
 * join comum perderia as duas pontas que mais interessam — quem foi convidado e
 * faltou, e quem apareceu sem ser chamado.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

export const esquemaFiltroParticipante = z.object({
  busca: z.string().trim().max(120).optional(),
  instituicaoId: z.string().uuid().optional(),
  situacao: z.enum([
    'todos',
    'presentes',
    'ausentes',
    'convidados',      // o convidado avulso do QR Code, sem vínculo
    'confirmados',
    'pendentes',       // convidado que ainda não respondeu
    'nao_registrados', // convidado sem nenhuma presença lançada
  ]).default('todos'),
});

/** Tradução de cada aba da tela para a condição SQL correspondente. */
const SITUACAO = {
  todos: '',
  presentes: "and p.status_presenca = 'presente'",
  ausentes: "and p.status_presenca = 'ausente'",
  convidados: "and p.tipo = 'convidado'",
  confirmados: "and p.status_confirmacao = 'confirmado'",
  pendentes: "and p.convite_id is not null and p.status_confirmacao = 'pendente'",
  nao_registrados: 'and p.presenca_id is null',
};

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} reuniaoId
 * @param {unknown} filtros
 */
export async function listarParticipantes(usuario, reuniaoId, filtros) {
  const u = exigir(usuario, 'presenca', 'ver');
  const f = validar(esquemaFiltroParticipante, filtros ?? {});

  /** @type {unknown[]} */
  const valores = [reuniaoId];
  let extra = SITUACAO[f.situacao];

  if (f.instituicaoId) {
    valores.push(f.instituicaoId);
    extra += ` and p.instituicao_id = $${valores.length}`;
  }
  if (f.busca) {
    valores.push(f.busca);
    extra += ` and imutavel_unaccent(lower(p.nome))
                 like '%' || imutavel_unaccent(lower($${valores.length})) || '%'`;
  }

  return comUsuario(u.id, async (tx) => {
    const existe = await tx.consultaUm('select id from reuniao where id = $1', [reuniaoId]);
    if (!existe) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');

    const linhas = await tx.consulta(
      `select * from vw_reuniao_participante p
        where p.reuniao_id = $1 ${extra}
        order by (p.status_presenca = 'presente') desc nulls last,
                 p.instituicao nulls last, p.nome`,
      valores,
    );

    // Os contadores das abas saem da lista completa, não da filtrada: a tela
    // precisa mostrar "Presentes (12)" mesmo estando na aba dos ausentes.
    const totais = await tx.consultaUm(
      `select count(*)::int as total,
              count(*) filter (where status_presenca = 'presente')::int  as presentes,
              count(*) filter (where status_presenca = 'ausente')::int   as ausentes,
              count(*) filter (where tipo = 'convidado')::int            as convidados,
              count(*) filter (where status_confirmacao = 'confirmado'
                                 and convite_id is not null)::int        as confirmados,
              count(*) filter (where convite_id is not null
                                 and status_confirmacao = 'pendente')::int as pendentes,
              count(*) filter (where presenca_id is null)::int           as nao_registrados
         from vw_reuniao_participante where reuniao_id = $1`,
      [reuniaoId],
    );

    return {
      dados: linhas.map((p) => ({
        conviteId: p.convite_id,
        presencaId: p.presenca_id,
        pessoaId: p.pessoa_id,
        instituicaoId: p.instituicao_id,
        nome: p.nome,
        instituicao: p.instituicao,
        cargo: p.cargo,
        tipo: p.tipo,
        statusConfirmacao: p.convite_id ? p.status_confirmacao : null,
        respondidoEm: p.respondido_em,
        statusPresenca: p.status_presenca,
        horarioCheckin: p.horario_checkin,
        origemPresenca: p.origem_presenca,
      })),
      totais: totais ?? {},
    };
  });
}
