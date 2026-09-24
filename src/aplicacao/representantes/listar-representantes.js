/**
 * CASO DE USO — Listagem de representantes (RF14, RF17).
 *
 * Representante aqui é a PESSOA com os vínculos ao lado, não uma linha por
 * vínculo: é o que mostra José da Silva — Startup Beta (atual), Universidade
 * Alfa (até 05/2025) em vez de dois Josés soltos.
 * A tela ainda não veio do UX/UI; os campos saem do que o modelo já garante.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { z } from 'zod';

export const esquemaFiltroRepresentante = z.object({
  busca: z.string().trim().max(120).optional(),
  instituicaoId: z.string().uuid().optional(),
  // 'ativo' traz só quem tem vínculo vigente; 'todos' inclui quem já saiu.
  vinculo: z.enum(['ativo', 'encerrado', 'todos']).default('ativo'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 */
export async function listarRepresentantes(usuario, filtros) {
  const u = exigir(usuario, 'representante', 'ver');
  const f = validar(esquemaFiltroRepresentante, filtros ?? {});

  /** @type {string[]} */
  const condicoes = [];
  /** @type {unknown[]} */
  const valores = [];
  /** @param {string} sql @param {unknown} valor */
  const onde = (sql, valor) => {
    valores.push(valor);
    condicoes.push(sql.replace('?', `$${valores.length}`));
  };

  if (f.busca) {
    // O mesmo termo procura em nome e em e-mail, então o marcador aparece duas
    // vezes na condição e o valor entra no array uma vez só.
    valores.push(f.busca);
    const n = `$${valores.length}`;
    condicoes.push(
      `(p.nome_busca like '%' || imutavel_unaccent(lower(${n})) || '%'
        or p.email like '%' || lower(${n}) || '%')`,
    );
  }

  if (f.instituicaoId) {
    onde(`exists (select 1 from vinculo v where v.pessoa_id = p.id
                  and v.instituicao_id = ?
                  ${f.vinculo === 'todos' ? '' : `and v.status = '${f.vinculo}'`})`,
    f.instituicaoId);
  } else if (f.vinculo !== 'todos') {
    condicoes.push(
      `exists (select 1 from vinculo v where v.pessoa_id = p.id and v.status = '${f.vinculo}')`,
    );
  }

  const filtro = condicoes.length ? `where ${condicoes.join(' and ')}` : '';
  valores.push(f.porPagina, (f.pagina - 1) * f.porPagina);

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select p.id, p.nome, p.email, p.telefone, p.cpf, p.created_at,
              count(*) over() as total_geral,
              -- Os vínculos vêm agregados em JSON: uma consulta só, e a tela
              -- recebe a pessoa já com o histórico dela dentro.
              coalesce(
                (select json_agg(json_build_object(
                          'vinculoId', v.id,
                          'instituicaoId', i.id,
                          'instituicao', i.nome,
                          'cargo', v.cargo,
                          'status', v.status,
                          'dataInicio', v.data_inicio,
                          'dataFim', v.data_fim)
                        order by (v.status = 'ativo') desc, v.data_inicio desc)
                   from vinculo v
                   join instituicao i on i.id = v.instituicao_id
                  where v.pessoa_id = p.id),
                '[]'::json) as vinculos
         from pessoa p
         ${filtro}
        order by p.nome
        limit $${valores.length - 1} offset $${valores.length}`,
      valores,
    );

    const total = linhas.length ? Number(linhas[0].total_geral) : 0;

    return {
      dados: linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        email: l.email,
        telefone: l.telefone,
        cpf: l.cpf,
        criadoEm: l.created_at,
        vinculos: l.vinculos,
        vinculoAtual: l.vinculos.find(
          (/** @type {{status: string}} */ v) => v.status === 'ativo') ?? null,
      })),
      total,
      pagina: f.pagina,
      porPagina: f.porPagina,
      paginas: Math.max(1, Math.ceil(total / f.porPagina)),
    };
  });
}
