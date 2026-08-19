import { NextRequest } from 'next/server';
import { z } from 'zod';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { ErroDeNegocio } from '@/lib/dominio/erros';
import { ok, falha } from '@/lib/dominio/resposta';

export const dynamic = 'force-dynamic';

const corpo = z.object({
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.'),
  observacoes: z.string().trim().optional(),
});

/**
 * POST — encerra um vínculo (RF16).
 *
 * Encerrar não é apagar: a linha permanece com status 'encerrado' e data_fim,
 * porque é ela que sustenta o histórico de participação daquele período.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = criarClienteServidor();

    const { data: sessao } = await supabase.auth.getUser();
    if (!sessao.user) {
      throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
    }

    const analise = corpo.safeParse(await req.json().catch(() => null));
    if (!analise.success) {
      throw new ErroDeNegocio(
        'DADOS_INVALIDOS',
        analise.error.issues[0]?.message ?? 'Dados inválidos.',
      );
    }
    const { dataFim, observacoes } = analise.data;

    const { data: vinculo, error: erroBusca } = await supabase
      .from('vinculo')
      .select('id, status, data_inicio')
      .eq('id', params.id)
      .maybeSingle();

    if (erroBusca) throw erroBusca;
    if (!vinculo) {
      throw new ErroDeNegocio('VINCULO_INVALIDO', 'Vínculo não encontrado.');
    }
    if (vinculo.status === 'encerrado') {
      throw new ErroDeNegocio('VINCULO_JA_ENCERRADO', 'Este vínculo já está encerrado.');
    }
    if (dataFim < vinculo.data_inicio) {
      throw new ErroDeNegocio(
        'DATA_FIM_ANTERIOR_AO_INICIO',
        `A data de encerramento não pode ser anterior a ${vinculo.data_inicio}.`,
      );
    }

    const { data, error } = await supabase
      .from('vinculo')
      .update({
        status: 'encerrado',
        data_fim: dataFim,
        ...(observacoes ? { observacoes } : {}),
      })
      .eq('id', params.id)
      .select('id, status, data_fim')
      .single();

    if (error) throw error;
    return ok({ id: data.id, status: data.status, dataFim: data.data_fim });
  } catch (e) {
    return falha(e);
  }
}
