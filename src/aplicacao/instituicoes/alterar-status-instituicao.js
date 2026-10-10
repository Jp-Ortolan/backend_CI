/**
 * CASO DE USO — Mudar a situação da instituição (RF09, RF10).
 *
 * Revisão de outubro: o fluxo de cadastro do Fórum.
 *
 *   rascunho → aguardando_documentos → em_analise ──→ ativa
 *                         ↑                 │
 *                         └── ajustes_solicitados
 *   ativa → em_processo_saida → inativa | desligada
 *
 * Quem faz o quê:
 *   gestão (admin e Diretoria)  qualquer passo do mapa abaixo. Aprovar a
 *                               entrada (em_analise → ativa) exige a ação
 *                               'aprovar' da matriz.
 *   representante               só ENVIA para análise, pela área da
 *                               instituição (minha-instituicao/enviar-analise).
 *
 * A trigger instituicao_status_hist (migration 001) grava o histórico com autor
 * e data sozinha.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaStatus, ROTULO_STATUS_INSTITUICAO } from './esquemas.js';

/** Para onde cada situação pode ir. Fora disto, não passa. */
export const TRANSICOES_INSTITUICAO = {
  rascunho: ['aguardando_documentos', 'em_analise'],
  aguardando_documentos: ['rascunho', 'em_analise'],
  em_analise: ['ativa', 'ajustes_solicitados', 'aguardando_documentos'],
  ajustes_solicitados: ['em_analise'],
  ativa: ['em_processo_saida', 'inativa', 'desligada'],
  em_processo_saida: ['ativa', 'inativa', 'desligada'],
  inativa: ['ativa', 'desligada'],
  // Re-entrada passa pela análise de novo, como uma instituição nova.
  desligada: ['em_analise'],
};

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 * @returns {Promise<{ id: string, status: string, dataSaida: string|null }>}
 */
export async function alterarStatusInstituicao(usuario, id, entrada) {
  const u = exigir(usuario, 'instituicao', 'editar');
  const d = validar(esquemaStatus, entrada);

  // O representante tem 'editar' (os contatos da instituição dele), mas a
  // situação é decisão da Diretoria. Ele envia para análise por outra rota.
  if (u.papel === 'representante') {
    throw new ErroDeNegocio('SEM_PERMISSAO',
      'A situação da instituição é decidida pela Diretoria. Para enviar o cadastro '
      + 'para análise, use "Enviar para análise" na área da instituição.');
  }
  if (d.status === 'ativa') exigir(u, 'instituicao', 'aprovar');

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      'select id, status, data_entrada, data_saida from instituicao where id = $1', [id],
    );
    if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    if (atual.status === d.status) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        `A instituição já está com a situação "${ROTULO_STATUS_INSTITUICAO[d.status]}".`);
    }

    const permitidas = TRANSICOES_INSTITUICAO[
      /** @type {keyof typeof TRANSICOES_INSTITUICAO} */ (atual.status)] ?? [];
    if (!permitidas.includes(d.status)) {
      throw new ErroDeNegocio('TRANSICAO_INVALIDA',
        `Não é possível ir de "${ROTULO_STATUS_INSTITUICAO[atual.status]}" para `
        + `"${ROTULO_STATUS_INSTITUICAO[d.status]}".`,
        { de: atual.status, para: d.status, permitidas });
    }

    const saindo = ['inativa', 'desligada'].includes(d.status);

    // Desligar é sair do Fórum de vez: o motivo é obrigatório.
    if (d.status === 'desligada' && !d.motivo) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe o motivo do desligamento.',
        { campos: [{ campo: 'motivo', mensagem: 'Informe o motivo do desligamento.' }] });
    }

    // Sair exige data. Se a tela não mandou, hoje é a resposta óbvia — a
    // Diretoria clicou em "Desativar" agora.
    let saida = d.dataSaida ?? atual.data_saida;
    if (saindo && !saida) saida = new Date().toISOString().slice(0, 10);
    // Voltar a ativa (ou a qualquer etapa de entrada) limpa a data de saída:
    // instituição ativa com data de saída faria a listagem mentir.
    if (!saindo && d.status !== 'em_processo_saida') saida = null;

    // Aprovar a entrada grava o ingresso no Fórum — é dele que o período de
    // participação conta.
    let entradaNoForum = atual.data_entrada;
    if (d.status === 'ativa' && !entradaNoForum) {
      entradaNoForum = d.dataEntrada ?? new Date().toISOString().slice(0, 10);
    }

    if (saida && entradaNoForum && saida < entradaNoForum) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        `A data de saída não pode ser anterior à entrada (${entradaNoForum}).`);
    }

    let linha;
    try {
      linha = await tx.consultaUm(
        `update instituicao
            set status = $2::status_instituicao,
                data_saida = $3,
                data_entrada = $4,
                motivo_saida = case when $2 in ('inativa', 'desligada', 'em_processo_saida')
                                    then coalesce($5, motivo_saida) else motivo_saida end,
                substituida_por_id = coalesce($6, substituida_por_id),
                updated_by = $7
          where id = $1
      returning id, status, data_saida, data_entrada`,
        [id, d.status, saida, entradaNoForum, d.motivo ?? null,
          d.substituidaPorId ?? null, u.id],
      );

      // O motivo vai também para o histórico de status, que é a linha do tempo
      // que a tela de detalhe mostra.
      if (linha && d.motivo) {
        await tx.consulta(
          `update instituicao_status_historico set motivo = $2
            where id = (select id from instituicao_status_historico
                         where instituicao_id = $1 order by alterado_em desc, id desc limit 1)`,
          [id, d.motivo],
        );
      }
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Seu perfil não permite alterar a situação desta instituição.');
    }

    return {
      id: linha.id,
      status: linha.status,
      dataSaida: linha.data_saida,
      dataEntrada: linha.data_entrada,
    };
  });
}
