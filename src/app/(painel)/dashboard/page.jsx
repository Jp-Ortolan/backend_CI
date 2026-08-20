import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigirPermissao } from '@/infraestrutura/seguranca/sessao.js';
import { ROTULO_PAPEL } from '@/dominio/permissoes.js';

export const dynamic = 'force-dynamic';

/**
 * @typedef {object} Indicadores
 * @property {string} instituicoes_ativas
 * @property {string} instituicoes_inativas
 * @property {string} instituicoes_em_processo
 * @property {string} representantes_ativos
 * @property {string} reunioes_realizadas
 * @property {string|null} media_presenca
 */

/**
 * Dashboard mínimo, para provar que a corrente inteira funciona:
 * cookie → sessão → papel → RLS → view de indicadores.
 * O visual definitivo vem do protótipo da trilha de UX/UI.
 */
export default async function PaginaDashboard() {
  const usuario = await exigirPermissao('indicador', 'ver');

  /** @type {Indicadores|null} */
  const ind = await comUsuario(usuario.id, (tx) =>
    tx.consultaUm('select * from vw_dashboard'),
  );

  /** @type {[string, string][]} */
  const CARTOES = ind ? [
    ['Instituições ativas', ind.instituicoes_ativas],
    ['Inativas', ind.instituicoes_inativas],
    ['Em processo', ind.instituicoes_em_processo],
    ['Representantes ativos', ind.representantes_ativos],
    ['Reuniões realizadas', ind.reunioes_realizadas],
    ['Média de presença', ind.media_presenca === null ? '—' : `${ind.media_presenca}%`],
  ] : [];

  return (
    <main className="conteudo">
      <header className="conteudo-cabecalho">
        <h1>Visão geral do ecossistema</h1>
        <p>{usuario.nome} · {ROTULO_PAPEL[usuario.papel]}</p>
      </header>

      {!ind && (
        <p className="msg erro" role="alert">Não foi possível carregar os indicadores.</p>
      )}

      <section className="kpis">
        {CARTOES.map(([rotulo, valor]) => (
          <article className="kpi" key={rotulo}>
            <p>{rotulo}</p>
            <strong>{valor}</strong>
          </article>
        ))}
      </section>
    </main>
  );
}
