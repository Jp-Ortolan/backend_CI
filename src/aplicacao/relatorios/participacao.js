/**
 * CASO DE USO — Percentual de participação por instituição (revisão de outubro).
 *
 * A regra de cálculo é UMA só, a mesma dos indicadores ("padronização das
 * regras de cálculo"):
 *   esperadas      = reuniões encerradas que CONTAM no percentual oficial,
 *                    dentro do período em que a instituição tinha vínculo
 *                    (vw_reuniao_esperada)
 *   com presença   = dessas, as que tiveram ao menos um representante presente
 *   percentual     = com presença ÷ esperadas
 * Ausência justificada aparece na coluna própria, mas não conta como presença.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { exigir, instituicaoDoRepresentante, validar } from '@/aplicacao/guarda.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaRelatorio = z.object({
  de: z.string().regex(DATA, 'Data inicial inválida (AAAA-MM-DD).').optional(),
  ate: z.string().regex(DATA, 'Data final inválida (AAAA-MM-DD).').optional(),
  vertenteId: z.coerce.number().int().positive().optional(),
  status: z.string().trim().max(40).optional(),
  formato: z.enum(['json', 'csv']).optional(),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 */
export async function participacaoPorInstituicao(usuario, filtros) {
  const u = exigir(usuario, 'relatorio', 'ver');
  const f = validar(esquemaRelatorio, filtros ?? {});

  /** @type {unknown[]} */
  const valores = [f.de ?? null, f.ate ?? null];
  const cond = [];
  if (!ehGestao(u.papel)) {
    valores.push(instituicaoDoRepresentante(u));
    cond.push(`i.id = $${valores.length}`);
  }
  if (f.vertenteId) { valores.push(f.vertenteId); cond.push(`i.vertente_id = $${valores.length}`); }
  if (f.status) { valores.push(f.status); cond.push(`i.status::text = $${valores.length}`); }

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select i.id, i.nome, i.status, t.nome as tipo, ve.nome as vertente,
              count(distinct e.reuniao_id) as esperadas,
              count(distinct pr.reuniao_id) filter (where pr.status = 'presente') as com_presenca,
              count(distinct pr.reuniao_id) filter (where pr.status = 'justificado') as justificadas
         from instituicao i
         left join tipo_instituicao t on t.id = i.tipo_instituicao_id
         left join vertente ve on ve.id = i.vertente_id
         left join vw_reuniao_esperada e
                on e.instituicao_id = i.id
               and ($1::date is null or e.reuniao_data >= $1::date)
               and ($2::date is null or e.reuniao_data <= $2::date)
         left join presenca pr on pr.instituicao_id = i.id and pr.reuniao_id = e.reuniao_id
        ${cond.length ? `where ${cond.join(' and ')}` : ''}
        group by i.id, t.nome, ve.nome
        order by i.nome`,
      valores,
    );

    return {
      periodo: { de: f.de ?? null, ate: f.ate ?? null },
      regra: 'Reuniões encerradas que contam no percentual oficial, no período de vínculo da '
        + 'instituição; conta como presença a reunião com ao menos um representante presente.',
      dados: linhas.map((l) => {
        const esperadas = Number(l.esperadas);
        const com = Number(l.com_presenca);
        return {
          instituicaoId: l.id,
          instituicao: l.nome,
          status: l.status,
          tipo: l.tipo,
          vertente: l.vertente,
          reunioesEsperadas: esperadas,
          reunioesComPresenca: com,
          reunioesJustificadas: Number(l.justificadas),
          // null quando não houve reunião esperada: 0% acusaria de faltar quem
          // nunca foi chamado.
          percentual: esperadas > 0 ? Number(((100 * com) / esperadas).toFixed(1)) : null,
        };
      }),
    };
  });
}
