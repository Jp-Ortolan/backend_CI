/**
 * CASO DE USO — Encerrar o vínculo de um representante (RF16).
 *
 * Encerrar não é apagar: a linha permanece com status 'encerrado' e data_fim,
 * porque é ela que sustenta o histórico de participação daquele período.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { pode } from '@/dominio/permissoes.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

export const esquemaEncerramento = z.object({
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.'),
  observacoes: z.string().trim().optional(),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} vinculoId
 * @param {unknown} entrada
 * @returns {Promise<object>}
 */
export async function encerrarVinculo(usuario, vinculoId, entrada) {
  if (!usuario) throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
  if (!pode(usuario.papel, 'vinculo', 'encerrar')) {
    throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite encerrar vínculos.');
  }

  const analise = esquemaEncerramento.safeParse(entrada);
  if (!analise.success) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      analise.error.issues[0]?.message ?? 'Dados inválidos.');
  }
  const { dataFim, observacoes } = analise.data;

  return comUsuario(usuario.id, async (tx) => {
    const atual = await tx.consultaUm(
      'select id, status, data_inicio from vinculo where id = $1', [vinculoId],
    );

    if (!atual) throw new ErroDeNegocio('VINCULO_INVALIDO', 'Vínculo não encontrado.');
    if (atual.status === 'encerrado') {
      throw new ErroDeNegocio('VINCULO_JA_ENCERRADO', 'Este vínculo já está encerrado.');
    }
    if (dataFim < atual.data_inicio) {
      throw new ErroDeNegocio('DATA_FIM_ANTERIOR_AO_INICIO',
        `A data de encerramento não pode ser anterior a ${atual.data_inicio}.`);
    }

    const linha = await tx.consultaUm(
      `update vinculo
          set status = 'encerrado', data_fim = $2,
              observacoes = coalesce($3, observacoes)
        where id = $1
    returning id, status, data_fim`,
      [vinculoId, dataFim, observacoes ?? null],
    );

    // Sem política de UPDATE, o PostgreSQL não levanta erro: ele simplesmente
    // não enxerga a linha e afeta zero registros. Por isso a checagem é aqui.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite esta alteração.');
    }

    return { id: linha.id, status: linha.status, dataFim: linha.data_fim };
  });
}
