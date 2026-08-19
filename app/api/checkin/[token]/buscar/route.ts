import { NextRequest } from 'next/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ErroDeNegocio } from '@/lib/dominio/erros';
import { ok, falha } from '@/lib/dominio/resposta';
import {
  exigirCheckinAberto, normalizarBusca, LIMITE_RESULTADOS_BUSCA,
} from '@/lib/dominio/checkin';
import type { ReuniaoPublica } from '@/lib/dominio/checkin';

export const dynamic = 'force-dynamic';

type Contexto = { params: { token: string } };

/**
 * GET — busca o participante pelo nome (RF28).
 *
 * Devolve no máximo 5 resultados e exige 3 caracteres: retornar nome e
 * instituição de quem ainda não confirmou presença é uma exposição pequena mas
 * real, e esses dois limites dificultam varrer a base pelo endpoint.
 */
export async function GET(req: NextRequest, { params }: Contexto) {
  try {
    const termo = normalizarBusca(req.nextUrl.searchParams.get('nome') ?? '');
    const supabase = criarClienteAdmin();

    const { data: reuniao, error: erroReuniao } = await supabase
      .from('reuniao')
      .select('id, titulo, data, hora_inicio, local, status, checkin_abre_em, checkin_fecha_em')
      .eq('qr_token', params.token)
      .maybeSingle();

    if (erroReuniao) throw erroReuniao;
    if (!reuniao) {
      throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Não encontramos esta reunião.');
    }
    exigirCheckinAberto(reuniao as unknown as ReuniaoPublica);

    // Só quem tem vínculo ativo aparece na busca.
    const { data, error } = await supabase
      .from('vinculo')
      .select('id, cargo, pessoa!inner(id, nome), instituicao!inner(id, nome)')
      .eq('status', 'ativo')
      .ilike('pessoa.nome', `%${termo}%`)
      .limit(LIMITE_RESULTADOS_BUSCA);

    if (error) throw error;

    type Linha = {
      id: string;
      cargo: string | null;
      pessoa: { id: string; nome: string } | { id: string; nome: string }[];
      instituicao: { id: string; nome: string } | { id: string; nome: string }[];
    };

    const um = <T,>(v: T | T[]): T => (Array.isArray(v) ? (v[0] as T) : v);

    const resultados = ((data ?? []) as unknown as Linha[]).map((l) => ({
      pessoaId: um(l.pessoa).id,
      nome: um(l.pessoa).nome,
      instituicao: um(l.instituicao).nome,
      cargo: l.cargo,
      vinculoId: l.id,
    }));

    return ok({ resultados });
  } catch (e) {
    return falha(e);
  }
}
