import { NextRequest } from 'next/server';
import { z } from 'zod';
import { comUsuario } from '@/lib/db/consulta';
import { usuarioAtual } from '@/lib/auth/sessao';
import { pode } from '@/lib/dominio/permissoes';
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
    const usuario = await usuarioAtual();
    if (!usuario) throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
    if (!pode(usuario.papel, 'vinculo', 'encerrar')) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite encerrar vínculos.');
    }

    const analise = corpo.safeParse(await req.json().catch(() => null));
    if (!analise.success) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        analise.error.issues[0]?.message ?? 'Dados inválidos.');
    }
    const { dataFim, observacoes } = analise.data;

    return await comUsuario(usuario.id, async (tx) => {
      const atual = await tx.consultaUm<{ id: string; status: string; data_inicio: string }>(
        'select id, status, data_inicio from vinculo where id = $1', [params.id],
      );

      if (!atual) throw new ErroDeNegocio('VINCULO_INVALIDO', 'Vínculo não encontrado.');
      if (atual.status === 'encerrado') {
        throw new ErroDeNegocio('VINCULO_JA_ENCERRADO', 'Este vínculo já está encerrado.');
      }
      if (dataFim < atual.data_inicio) {
        throw new ErroDeNegocio('DATA_FIM_ANTERIOR_AO_INICIO',
          `A data de encerramento não pode ser anterior a ${atual.data_inicio}.`);
      }

      const linha = await tx.consultaUm<{ id: string; status: string; data_fim: string }>(
        `update vinculo
            set status = 'encerrado', data_fim = $2,
                observacoes = coalesce($3, observacoes)
          where id = $1
      returning id, status, data_fim`,
        [params.id, dataFim, observacoes ?? null],
      );

      if (!linha) {
        throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite esta alteração.');
      }
      return ok({ id: linha.id, status: linha.status, dataFim: linha.data_fim });
    });
  } catch (e) {
    return falha(e);
  }
}
