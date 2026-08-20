import { criarClienteServidor } from '@/lib/supabase/servidor';
import { exigirPermissao } from '@/lib/auth/sessao';
import { ROTULO_PAPEL } from '@/lib/dominio/permissoes';

export const dynamic = 'force-dynamic';

interface Indicadores {
  instituicoes_ativas: number;
  instituicoes_inativas: number;
  instituicoes_em_processo: number;
  representantes_ativos: number;
  reunioes_realizadas: number;
  media_presenca: number | null;
}

/**
 * Dashboard mínimo, só para provar que a corrente inteira funciona:
 * sessão → papel → RLS → view de indicadores. O visual definitivo vem do
 * protótipo da trilha de UX/UI.
 */
export default async function PaginaDashboard() {
  const usuario = await exigirPermissao('indicador', 'ver');
  const supabase = criarClienteServidor();

  const { data, error } = await supabase.from('vw_dashboard').select('*').maybeSingle();
  const ind = (data ?? null) as Indicadores | null;

  const CARTOES: [string, string][] = ind ? [
    ['Instituições ativas', String(ind.instituicoes_ativas)],
    ['Inativas', String(ind.instituicoes_inativas)],
    ['Em processo', String(ind.instituicoes_em_processo)],
    ['Representantes ativos', String(ind.representantes_ativos)],
    ['Reuniões realizadas', String(ind.reunioes_realizadas)],
    ['Média de presença', ind.media_presenca === null ? '—' : `${ind.media_presenca}%`],
  ] : [];

  return (
    <main className="conteudo">
      <header className="conteudo-cabecalho">
        <h1>Visão geral do ecossistema</h1>
        <p>{usuario.nome} · {ROTULO_PAPEL[usuario.papel]}</p>
      </header>

      {error && (
        <p className="msg erro" role="alert">
          Não foi possível carregar os indicadores.
        </p>
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
