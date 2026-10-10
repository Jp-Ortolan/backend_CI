/**
 * CASO DE USO — Lista de solicitações.
 *
 * A gestão vê a fila inteira (por padrão, as pendentes primeiro); o
 * representante vê as da instituição dele — quem recorta é o RLS.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaFiltroSolicitacao, ROTULO_SOLICITACAO } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 */
export async function listarSolicitacoes(usuario, filtros) {
  const u = exigir(usuario, 'solicitacao', 'ver');
  const f = validar(esquemaFiltroSolicitacao, filtros ?? {});

  /** @type {string[]} */ const condicoes = [];
  /** @type {unknown[]} */ const valores = [];
  if (f.status) { valores.push(f.status); condicoes.push(`s.status = $${valores.length}::status_solicitacao`); }
  if (f.tipo) { valores.push(f.tipo); condicoes.push(`s.tipo = $${valores.length}::tipo_solicitacao`); }
  if (f.instituicaoId) { valores.push(f.instituicaoId); condicoes.push(`s.instituicao_id = $${valores.length}`); }
  const onde = condicoes.length ? `where ${condicoes.join(' and ')}` : '';
  valores.push(f.porPagina, (f.pagina - 1) * f.porPagina);

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select s.id, s.tipo, s.status, s.justificativa, s.created_at, s.analisado_em,
              s.resposta, s.instituicao_id, i.nome as instituicao,
              autor.nome as solicitado_por, analista.nome as analisado_por,
              count(*) over() as total_geral
         from solicitacao s
         join instituicao i on i.id = s.instituicao_id
         left join vw_usuario_publico autor    on autor.id = s.solicitado_por
         left join vw_usuario_publico analista on analista.id = s.analisado_por
         ${onde}
        order by (s.status = 'pendente') desc, s.created_at desc
        limit $${valores.length - 1} offset $${valores.length}`,
      valores,
    );
    const total = linhas.length ? Number(linhas[0].total_geral) : 0;

    return {
      dados: linhas.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        rotulo: ROTULO_SOLICITACAO[l.tipo],
        status: l.status,
        instituicaoId: l.instituicao_id,
        instituicao: l.instituicao,
        justificativa: l.justificativa,
        solicitadoPor: l.solicitado_por,
        criadaEm: l.created_at,
        analisadoPor: l.analisado_por,
        analisadoEm: l.analisado_em,
        resposta: l.resposta,
      })),
      total,
      pagina: f.pagina,
      porPagina: f.porPagina,
      paginas: Math.max(1, Math.ceil(total / f.porPagina)),
    };
  });
}
