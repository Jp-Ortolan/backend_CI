/**
 * CASO DE USO — Listagem de reuniões (RF24).
 *
 * Cada linha já vem com convidados, confirmados e presentes, vindos de
 * vw_resumo_reuniao e não de coluna gravada: contador guardado envelhece na
 * primeira correção de presença.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaFiltroReuniao } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 */
export async function listarReunioes(usuario, filtros) {
  const u = exigir(usuario, 'reuniao', 'ver');
  const f = validar(esquemaFiltroReuniao, filtros ?? {});

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
    onde(`(imutavel_unaccent(lower(r.titulo)) like '%' || imutavel_unaccent(lower(?)) || '%')`,
      f.busca);
  }
  if (f.status) onde('r.status = ?::status_reuniao', f.status);
  if (f.de) onde('r.data >= ?::date', f.de);
  if (f.ate) onde('r.data <= ?::date', f.ate);

  // As abas da tela. 'proximas' inclui hoje: reunião de hoje ainda não passou.
  if (f.periodo === 'proximas') condicoes.push('r.data >= current_date');
  if (f.periodo === 'passadas') condicoes.push('r.data < current_date');

  if (f.instituicaoId) {
// Convidada OU presente: só convite esconderia quem apareceu sem ser chamado,
// só presença esconderia quem foi chamado e faltou. O mesmo id aparece duas
// vezes na condição e entra uma vez no array.
    valores.push(f.instituicaoId);
    const n = `$${valores.length}`;
    condicoes.push(
      `(exists (select 1 from reuniao_convite c
                 where c.reuniao_id = r.id and c.instituicao_id = ${n})
        or exists (select 1 from presenca p
                    where p.reuniao_id = r.id and p.instituicao_id = ${n}))`,
    );
  }

  const filtro = condicoes.length ? `where ${condicoes.join(' and ')}` : '';
  const direcao = f.ordem === 'asc' ? 'asc' : 'desc';
  valores.push(f.porPagina, (f.pagina - 1) * f.porPagina);

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select r.id, r.titulo, r.descricao, r.data, r.hora_inicio, r.hora_fim,
              r.local, r.endereco, r.status,
              v.esperados, v.convites_enviados, v.confirmados,
              v.presentes, v.ausentes, v.convidados,
              v.percentual_comparecimento,
              count(*) over() as total_geral
         from reuniao r
         join vw_resumo_reuniao v on v.reuniao_id = r.id
         ${filtro}
        order by r.data ${direcao}, r.hora_inicio ${direcao} nulls last
        limit $${valores.length - 1} offset $${valores.length}`,
      valores,
    );

    const total = linhas.length ? Number(linhas[0].total_geral) : 0;

    return {
      dados: linhas.map((l) => ({
        id: l.id,
        titulo: l.titulo,
        descricao: l.descricao,
        data: l.data,
        horaInicio: l.hora_inicio,
        horaFim: l.hora_fim,
        local: l.local,
        endereco: l.endereco,
        status: l.status,
        esperados: Number(l.esperados),
        convitesEnviados: Number(l.convites_enviados),
        confirmados: Number(l.confirmados),
        presentes: Number(l.presentes),
        ausentes: Number(l.ausentes),
        convidados: Number(l.convidados),
// null enquanto a reunião não encerra: antes disso o número não significaria
// nada e a tela mostraria queda onde só houve reunião que não aconteceu.
        percentualComparecimento: l.status === 'encerrada'
          ? l.percentual_comparecimento : null,
      })),
      total,
      pagina: f.pagina,
      porPagina: f.porPagina,
      paginas: Math.max(1, Math.ceil(total / f.porPagina)),
    };
  });
}
