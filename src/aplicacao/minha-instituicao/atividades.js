/**
 * CASO DE USO — Reuniões e eventos de que a instituição participou.
 *
 * "Consultar as reuniões e eventos em que participou" e "ver o percentual de
 * participação da instituição", na área da instituição. Serve também à gestão,
 * para qualquer instituição.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, exigirInstituicaoPropria, validar } from '@/aplicacao/guarda.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaAtividades = z.object({
  natureza: z.enum(['reuniao', 'evento']).optional(),
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
export async function atividadesDaInstituicao(usuario, instituicaoId, filtros) {
  const u = exigir(usuario, 'presenca', 'ver');
  exigirInstituicaoPropria(u, instituicaoId);
  const f = validar(esquemaAtividades, filtros ?? {});

  /** @type {unknown[]} */ const valores = [instituicaoId];
  let extra = '';
  if (f.natureza) { valores.push(f.natureza); extra += ` and r.natureza = $${valores.length}::natureza_atividade`; }
  if (f.de) { valores.push(f.de); extra += ` and r.data >= $${valores.length}::date`; }
  if (f.ate) { valores.push(f.ate); extra += ` and r.data <= $${valores.length}::date`; }
  valores.push(f.porPagina, (f.pagina - 1) * f.porPagina);

  return comUsuario(u.id, async (tx) => {
    const inst = await tx.consultaUm('select id, nome from instituicao where id = $1', [instituicaoId]);
    if (!inst) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    // Toda atividade com presença, convite OU expectativa oficial da
    // instituição. Expectativa oficial sem presença é falta — aparece também.
    const linhas = await tx.consulta(
      `select r.id, r.titulo, r.natureza, t.nome as tipo, r.numero, r.data, r.status,
              r.conta_participacao,
              count(p.id) filter (where p.status = 'presente')    as presentes,
              count(p.id) filter (where p.status = 'ausente')     as ausentes,
              count(p.id) filter (where p.status = 'justificado') as justificados,
              coalesce(json_agg(json_build_object(
                  'pessoaId', pe.id, 'nome', coalesce(pe.nome, p.nome_informado),
                  'status', p.status, 'horarioCheckin', p.horario_checkin, 'modo', p.modo)
                order by pe.nome) filter (where p.id is not null), '[]') as participantes,
              count(*) over() as total_geral
         from reuniao r
         left join tipo_atividade t on t.id = r.tipo_atividade_id
         left join presenca p on p.reuniao_id = r.id and p.instituicao_id = $1
         left join pessoa  pe on pe.id = p.pessoa_id
        where r.status <> 'rascunho'
          and (p.id is not null
               or exists (select 1 from reuniao_convite c
                           where c.reuniao_id = r.id and c.instituicao_id = $1)
               or exists (select 1 from vw_reuniao_esperada e
                           where e.reuniao_id = r.id and e.instituicao_id = $1))
          ${extra}
        group by r.id, t.nome
        order by r.data desc
        limit $${valores.length - 1} offset $${valores.length}`,
      valores,
    );

    const resumo = await tx.consultaUm(
      `select reunioes_esperadas, reunioes_com_presenca, percentual_participacao
         from vw_participacao_instituicao where instituicao_id = $1`, [instituicaoId]);

    const total = linhas.length ? Number(linhas[0].total_geral) : 0;

    return {
      instituicao: { id: inst.id, nome: inst.nome },
      // O percentual OFICIAL: só reuniões que contam (conta_participacao).
      participacaoOficial: {
        reunioesEsperadas: Number(resumo?.reunioes_esperadas ?? 0),
        reunioesComPresenca: Number(resumo?.reunioes_com_presenca ?? 0),
        percentual: resumo?.percentual_participacao === null || resumo?.percentual_participacao === undefined
          ? null : Number(resumo.percentual_participacao),
      },
      dados: linhas.map((l) => ({
        id: l.id,
        titulo: l.titulo,
        natureza: l.natureza,
        tipo: l.tipo,
        numero: l.numero,
        data: l.data,
        status: l.status,
        contaParticipacao: l.conta_participacao,
        compareceu: Number(l.presentes) > 0,
        presentes: Number(l.presentes),
        ausentes: Number(l.ausentes),
        justificados: Number(l.justificados),
        participantes: l.participantes,
      })),
      total,
      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  });
}
