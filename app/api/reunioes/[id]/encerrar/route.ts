import { NextRequest } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { ErroDeNegocio } from '@/lib/dominio/erros';
import { ok, falha } from '@/lib/dominio/resposta';
import type { Vinculo } from '@/lib/tipos-banco';

export const dynamic = 'force-dynamic';

/**
 * POST — encerra a reunião e marca como ausente quem deveria ter comparecido
 * e não registrou presença (RF39).
 *
 * É este passo que fecha o denominador dos indicadores: sem ele, quem faltou
 * simplesmente não existe e o percentual de participação fica sempre em 100%.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = criarClienteServidor();

    const { data: sessao } = await supabase.auth.getUser();
    if (!sessao.user) {
      throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
    }

    const { data: reuniao, error: erroReuniao } = await supabase
      .from('reuniao').select('id, data, status').eq('id', params.id).maybeSingle();

    if (erroReuniao) throw erroReuniao;
    if (!reuniao) {
      throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');
    }
    if (reuniao.status === 'cancelada') {
      throw new ErroDeNegocio('REUNIAO_CANCELADA', 'Esta reunião foi cancelada.');
    }

    // Quem tinha vínculo válido NA DATA da reunião era esperado ali.
    const { data: vinculos, error: erroVinculos } = await supabase
      .from('vinculo')
      .select('id, pessoa_id, instituicao_id, cargo, status, data_inicio, data_fim')
      .lte('data_inicio', reuniao.data);

    if (erroVinculos) throw erroVinculos;

    const esperados = ((vinculos ?? []) as Vinculo[]).filter(
      (v) => v.data_fim === null || v.data_fim >= reuniao.data,
    );

    const { data: presencas, error: erroPresencas } = await supabase
      .from('presenca').select('pessoa_id').eq('reuniao_id', reuniao.id);
    if (erroPresencas) throw erroPresencas;

    const jaRegistrados = new Set(
      (presencas ?? []).map((p) => p.pessoa_id).filter(Boolean) as string[],
    );

    const ausentes = esperados
      .filter((v) => !jaRegistrados.has(v.pessoa_id))
      .map((v) => ({
        reuniao_id: reuniao.id,
        pessoa_id: v.pessoa_id,
        vinculo_id: v.id,
        instituicao_id: v.instituicao_id,
        cargo_no_momento: v.cargo,
        tipo: 'representante' as const,
        status: 'ausente' as const,
        origem: 'manual' as const,
        registrado_por: sessao.user.id,
      }));

    if (ausentes.length > 0) {
      const { error } = await supabase.from('presenca').insert(ausentes);
      if (error) throw error;
    }

    const { error: erroStatus } = await supabase
      .from('reuniao').update({ status: 'encerrada' }).eq('id', reuniao.id);
    if (erroStatus) throw erroStatus;

    const { data: resumo } = await supabase
      .from('vw_resumo_reuniao')
      .select('presentes, ausentes, convidados, percentual_presenca')
      .eq('reuniao_id', reuniao.id)
      .maybeSingle();

    return ok({
      status: 'encerrada',
      presentes: resumo?.presentes ?? 0,
      ausentesMarcados: ausentes.length,
      convidados: resumo?.convidados ?? 0,
      percentualPresenca: resumo?.percentual_presenca ?? null,
    });
  } catch (e) {
    return falha(e);
  }
}
