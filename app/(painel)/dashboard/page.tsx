import { comUsuario } from '@/lib/db/consulta';
import { exigirPermissao } from '@/lib/auth/sessao';
import { ROTULO_PAPEL } from '@/lib/dominio/permissoes';

export const dynamic = 'force-dynamic';

interface Indicadores {
  instituicoes_ativas: string;
  instituicoes_inativas: string;
  instituicoes_em_processo: string;
  representantes_ativos: string;
  reunioes_realizadas: string;
  media_presenca: string | null;
}

/**
 * Dashboard mínimo, para provar que a corrente inteira funciona:
 * cookie → sessão → papel → RLS → view de indicadores.
 * O visual definitivo vem do protótipo da trilha de UX/UI.
 */
export default async function PaginaDashboard() {
  const usuario = await exigirPermissao('indicador', 'ver');

  const ind = await comUsuario(usuario.id, (tx) =>
    tx.consultaUm<Indicadores>('select * from vw_dashboard'),
  );

  const CARTOES: [string, string][] = ind ? [
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
