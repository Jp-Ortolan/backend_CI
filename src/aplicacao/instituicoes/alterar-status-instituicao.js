/**
 * CASO DE USO — Ativar / desativar instituição (RF09, RF10).
 *
 * É o caminho certo quando alguém tenta excluir uma instituição que já tem
 * histórico. A trigger instituicao_status_hist (migration 001) grava o histórico
 * sozinha, com autor e data.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaStatus } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 * @returns {Promise<{ id: string, status: string, dataSaida: string|null }>}
 */
export async function alterarStatusInstituicao(usuario, id, entrada) {
  const u = exigir(usuario, 'instituicao', 'editar');
  const { status, dataSaida, motivo } = validar(esquemaStatus, entrada);

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      'select id, status, data_entrada, data_saida from instituicao where id = $1', [id],
    );
    if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    if (atual.status === status) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', `A instituição já está com a situação "${status}".`);
    }

    // Sair exige data. Se a tela não mandou, hoje é a resposta óbvia — o
    // gestor clicou em "Desativar" agora.
    let saida = dataSaida ?? atual.data_saida;
    if (status === 'inativa' && !saida) {
      saida = new Date().toISOString().slice(0, 10);
    }
    // Voltar a ativa limpa a data de saída: instituição ativa com data de saída
    // preenchida faria a listagem mentir sobre quem ainda está no ecossistema.
    if (status === 'ativa' || status === 'em_processo_entrada') {
      saida = null;
    }

    if (saida && atual.data_entrada && saida < atual.data_entrada) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        `A data de saída não pode ser anterior à entrada (${atual.data_entrada}).`);
    }

    let linha;
    try {
      linha = await tx.consultaUm(
        `update instituicao
            set status = $2::status_instituicao,
                data_saida = $3,
                observacoes = case when $4::text is null then observacoes
                                   else coalesce(observacoes || E'\\n', '') || $4 end,
                updated_by = $5
          where id = $1
      returning id, status, data_saida`,
        [id, status, saida, motivo ?? null, u.id],
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Seu perfil não permite alterar a situação desta instituição.');
    }

    return { id: linha.id, status: linha.status, dataSaida: linha.data_saida };
  });
}
