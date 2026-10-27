/**
 * O que a APROVAÇÃO de cada tipo de solicitação faz no cadastro.
 *
 * Roda dentro da transação da decisão, com o usuário da gestão declarado: se
 * qualquer passo falhar (CNPJ repetido, titular duplicado), a solicitação
 * continua pendente e nada do cadastro muda. Aprovar pela metade não existe.
 */
import { ErroDeNegocio } from '@/dominio/erros.js';
import { paraColunas, gravarGruposDaInstituicao } from '@/aplicacao/instituicoes/esquemas.js';
import { TRANSICOES_INSTITUICAO } from '@/aplicacao/instituicoes/alterar-status-instituicao.js';
import { aplicarMarcacao } from '@/aplicacao/presencas/marcar-presenca.js';
import {
  designarRepresentacao, encerrarVinculoDaInstituicao, resolverPessoa,
} from '@/aplicacao/vinculos/representacao.js';
import { aplicarRegistroInstituicao } from '@/aplicacao/governanca/instituicao-registro.js';

/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * @param {Transacao} tx
 * @param {{ id: string, instituicao_id: string, tipo: string, dados: any,
 *           documento_id: string|null }} s
 * @param {{ id: string, papel: string }} quem  quem aprovou
 * @returns {Promise<Record<string, unknown>>}  o que mudou, para a resposta
 */
export async function aplicarSolicitacao(tx, s, quem) {
  const usuarioId = quem.id;
  const d = s.dados ?? {};

  switch (s.tipo) {
    // ------------------------------------------------------------------------
    case 'alterar_dados': {
      const { grupoTrabalhoIds, ...campos } = d.campos ?? {};
      const colunas = paraColunas(campos);
      if (Object.keys(colunas).length) {
        colunas.updated_by = usuarioId;
        const nomes = Object.keys(colunas);
        await tx.consulta(
          `update instituicao set ${nomes.map((c, n) => `${c} = $${n + 2}`).join(', ')}
            where id = $1`,
          [s.instituicao_id, ...Object.values(colunas)],
        );
      }
      if (Array.isArray(grupoTrabalhoIds)) {
        await gravarGruposDaInstituicao(tx, s.instituicao_id, grupoTrabalhoIds);
      }
      return { camposAlterados: Object.keys(d.campos ?? {}) };
    }

    // ------------------------------------------------------------------------
    case 'troca_titular':
    case 'troca_suplente':
    case 'incluir_representante': {
      const alvo = s.tipo === 'troca_titular' ? 'titular'
        : s.tipo === 'troca_suplente' ? 'suplente'
          : (d.tipoRepresentacao ?? 'integrante');
      const pessoaId = await resolverPessoa(tx, s.instituicao_id, d);
      return designarRepresentacao(tx, s.instituicao_id, {
        alvo, pessoaId, inicio: d.dataInicio, cargo: d.cargo, documentoId: s.documento_id,
        anterior: d.anterior, motivo: d.motivo ?? `Substituído (${s.tipo.replace('_', ' de ')})`,
      });
    }

    // ------------------------------------------------------------------------
    // Contrato do front: substituir um vínculo específico por outra pessoa.
    case 'substituicao_representante': {
      const novo = d.novoRepresentante ?? {};
      const pessoaId = await resolverPessoa(tx, s.instituicao_id, {
        pessoa: { nome: novo.nome, email: novo.email || null, telefone: novo.telefone || null },
      });
      return designarRepresentacao(tx, s.instituicao_id, {
        alvo: novo.tipo === 'adicional' || !novo.tipo ? 'integrante' : novo.tipo,
        pessoaId, cargo: novo.cargo ?? null, documentoId: s.documento_id,
        vinculoAnteriorId: d.representanteAnteriorId,
        motivo: s.justificativa ?? 'Substituição aprovada pela Diretoria',
      });
    }

    case 'encerramento_representante':
      return encerrarVinculoDaInstituicao(tx, s.instituicao_id, d.representanteAnteriorId, {
        motivo: s.justificativa ?? 'Encerramento aprovado pela Diretoria',
      });

    // ------------------------------------------------------------------------
    case 'remover_representante':
      return encerrarVinculoDaInstituicao(tx, s.instituicao_id, d.vinculoId, {
        dataFim: d.dataFim, motivo: d.motivo,
      });

    // ------------------------------------------------------------------------
    // Contrato do front: a ficha inteira, com os nomes de campo da tela.
    case 'alteracao_cadastral': {
      const aplicados = await aplicarRegistroInstituicao(tx, s.instituicao_id, d.alteracoes ?? {}, quem);
      return { camposAlterados: aplicados };
    }

    // ------------------------------------------------------------------------
    // Logo, ofício ou termo enviado pela instituição: passa a valer. A logo
    // vira a logo da instituição (e só agora pode ir para o painel público).
    case 'aprovacao_documento': {
      const doc = await tx.consultaUm(
        `update documento set status_analise = 'aprovado'
          where id = $1 and instituicao_id = $2 returning id, tipo`,
        [d.documentoId ?? s.documento_id, s.instituicao_id]);
      if (!doc) throw new ErroDeNegocio('NAO_ENCONTRADO', 'O documento desta solicitação não existe mais.');
      if (doc.tipo === 'logo') {
        await tx.consulta(
          'update instituicao set logo_documento_id = $2, updated_by = $3 where id = $1',
          [s.instituicao_id, doc.id, quem.id]);
      }
      return { documentoId: doc.id, tipo: doc.tipo, status: 'aprovado' };
    }

    // ------------------------------------------------------------------------
    case 'novo_oficio': {
      // O ofício já está anexado; aprovar é reconhecê-lo como o vigente. Se a
      // instituição tinha um anterior do mesmo tipo, ele vira versão antiga.
      if (s.documento_id) {
        await tx.consulta(
          `update documento d
              set tipo = coalesce(d.tipo, 'oficio'),
                  substitui_id = coalesce(d.substitui_id, (
                    select o.id from documento o
                     where o.instituicao_id = $2 and o.tipo = 'oficio' and o.id <> d.id
                       and not exists (select 1 from documento n where n.substitui_id = o.id)
                     order by o.created_at desc limit 1))
            where d.id = $1`,
          [s.documento_id, s.instituicao_id],
        );
      }
      return { documentoId: s.documento_id };
    }

    // ------------------------------------------------------------------------
    case 'entrada_forum': {
      const i = await tx.consultaUm('select status, data_entrada from instituicao where id = $1',
        [s.instituicao_id]);
      if (i.status === 'ativa') return { status: 'ativa' };
      if (!['em_analise', 'ajustes_solicitados', 'aguardando_documentos', 'rascunho', 'desligada']
        .includes(i.status)) {
        throw new ErroDeNegocio('TRANSICAO_INVALIDA',
          `A instituição está "${i.status}" e não pode ser aprovada para entrada agora.`);
      }
      await tx.consulta(
        `update instituicao set status = 'ativa', data_saida = null,
                data_entrada = coalesce(data_entrada, current_date), updated_by = $2
          where id = $1`,
        [s.instituicao_id, usuarioId],
      );
      return { status: 'ativa' };
    }

    // ------------------------------------------------------------------------
    case 'saida_forum': {
      const i = await tx.consultaUm(
        'select status, data_entrada from instituicao where id = $1', [s.instituicao_id]);
      if (!(TRANSICOES_INSTITUICAO[i.status] ?? []).includes('desligada')) {
        throw new ErroDeNegocio('TRANSICAO_INVALIDA',
          `A instituição está "${i.status}" e não pode ser desligada a partir daí.`);
      }
      const saida = d.dataSaida ?? hoje();
      if (i.data_entrada && saida < i.data_entrada) {
        throw new ErroDeNegocio('DADOS_INVALIDOS',
          `A data de saída não pode ser anterior à entrada (${i.data_entrada}).`);
      }
      await tx.consulta(
        `update instituicao set status = 'desligada', data_saida = $2,
                motivo_saida = $3, updated_by = $4
          where id = $1`,
        [s.instituicao_id, saida, d.motivo, usuarioId],
      );
      return { status: 'desligada', dataSaida: saida };
    }

    // ------------------------------------------------------------------------
    case 'correcao_presenca': {
      const r = await aplicarMarcacao(tx, usuarioId, d.reuniaoId, {
        pessoaId: d.pessoaId, status: d.status, observacoes: d.observacoes ?? null,
        modo: d.modo ?? null,
      });
      return { presencaId: r.id, status: r.status };
    }

    default:
      throw new ErroDeNegocio('DADOS_INVALIDOS', `Tipo de solicitação desconhecido: ${s.tipo}.`);
  }
}
