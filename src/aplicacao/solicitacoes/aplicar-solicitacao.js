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

/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * @param {Transacao} tx
 * @param {{ id: string, instituicao_id: string, tipo: string, dados: any,
 *           documento_id: string|null }} s
 * @param {string} usuarioId  quem aprovou
 * @returns {Promise<Record<string, unknown>>}  o que mudou, para a resposta
 */
export async function aplicarSolicitacao(tx, s, usuarioId) {
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
      const inicio = d.dataInicio ?? hoje();

      const pessoaId = await resolverPessoa(tx, d);

      // Quem ocupa hoje a função sai dela ANTES de o novo entrar: o índice
      // vinculo_titular_unico não admite dois titulares vigentes nem por um
      // instante dentro da transação.
      /** @type {string|null} */
      let anteriorId = null;
      if (alvo === 'titular' || alvo === 'suplente') {
        const anterior = await tx.consultaUm(
          `select id, pessoa_id, data_inicio from vinculo
            where instituicao_id = $1 and status = 'ativo' and tipo_representacao = $2::tipo_representacao`,
          [s.instituicao_id, alvo],
        );
        if (anterior && anterior.pessoa_id !== pessoaId) {
          anteriorId = anterior.id;
          if (d.anterior === 'manter_como_integrante') {
            await tx.consulta(
              `update vinculo set tipo_representacao = 'integrante',
                      motivo_encerramento = null
                where id = $1`, [anterior.id]);
          } else {
            // A data de fim não pode ser anterior ao início do próprio vínculo.
            const fim = inicio < anterior.data_inicio ? anterior.data_inicio : inicio;
            await tx.consulta(
              `update vinculo set status = 'encerrado', data_fim = $2,
                      motivo_encerramento = $3
                where id = $1`,
              [anterior.id, fim, d.motivo ?? `Substituído (${s.tipo.replace('_', ' de ')})`],
            );
          }
        }
      }

      // A pessoa já representa a instituição (era suplente e vira titular,
      // por exemplo): muda o tipo do vínculo que existe, sem abrir outro.
      const existente = await tx.consultaUm(
        `select id from vinculo
          where pessoa_id = $1 and instituicao_id = $2 and status = 'ativo'`,
        [pessoaId, s.instituicao_id],
      );

      let vinculoId;
      if (existente) {
        await tx.consulta(
          `update vinculo set tipo_representacao = $2::tipo_representacao,
                  cargo = coalesce($3, cargo),
                  oficio_documento_id = coalesce($4, oficio_documento_id)
            where id = $1`,
          [existente.id, alvo, d.cargo ?? null, s.documento_id],
        );
        vinculoId = existente.id;
      } else {
        const novo = await tx.consultaUm(
          `insert into vinculo (pessoa_id, instituicao_id, cargo, data_inicio,
                                tipo_representacao, oficio_documento_id)
           values ($1, $2, $3, $4, $5::tipo_representacao, $6)
           returning id`,
          [pessoaId, s.instituicao_id, d.cargo ?? null, inicio, alvo, s.documento_id],
        );
        vinculoId = novo.id;
      }

      return { pessoaId, vinculoId, tipoRepresentacao: alvo, vinculoAnteriorId: anteriorId };
    }

    // ------------------------------------------------------------------------
    case 'remover_representante': {
      const v = await tx.consultaUm(
        `select id, data_inicio, status from vinculo
          where id = $1 and instituicao_id = $2`,
        [d.vinculoId, s.instituicao_id],
      );
      if (!v) throw new ErroDeNegocio('VINCULO_INVALIDO', 'O vínculo indicado não é desta instituição.');
      if (v.status === 'encerrado') {
        throw new ErroDeNegocio('VINCULO_JA_ENCERRADO', 'Este vínculo já estava encerrado.');
      }
      const fim = d.dataFim ?? hoje();
      if (fim < v.data_inicio) {
        throw new ErroDeNegocio('DATA_FIM_ANTERIOR_AO_INICIO',
          `A data de encerramento não pode ser anterior a ${v.data_inicio}.`);
      }
      await tx.consulta(
        `update vinculo set status = 'encerrado', data_fim = $2, motivo_encerramento = $3
          where id = $1`,
        [v.id, fim, d.motivo],
      );
      return { vinculoId: v.id, dataFim: fim };
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
      });
      return { presencaId: r.id, status: r.status };
    }

    default:
      throw new ErroDeNegocio('DADOS_INVALIDOS', `Tipo de solicitação desconhecido: ${s.tipo}.`);
  }
}

/**
 * A pessoa que assume a representação: a indicada por id, ou uma nova criada
 * com os dados do pedido (reaproveitando quem já tiver o mesmo CPF ou e-mail —
 * decisão de modelagem 1: a pessoa é uma só, os vínculos é que mudam).
 *
 * @param {Transacao} tx
 * @param {any} d
 * @returns {Promise<string>}
 */
async function resolverPessoa(tx, d) {
  if (d.pessoaId) {
    const p = await tx.consultaUm('select id from pessoa where id = $1', [d.pessoaId]);
    if (!p) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Pessoa indicada não encontrada.');
    return p.id;
  }

  const n = d.pessoa;
  const existente = await tx.consultaUm(
    `select id from pessoa
      where ($1::text is not null and cpf = $1)
         or ($2::text is not null and email = $2)
      order by (cpf = $1) desc nulls last
      limit 1`,
    [n.cpf ?? null, n.email ?? null],
  );
  if (existente) return existente.id;

  const nova = await tx.consultaUm(
    `insert into pessoa (nome, cpf, email, telefone) values ($1, $2, $3, $4) returning id`,
    [n.nome, n.cpf ?? null, n.email ?? null, n.telefone ?? null],
  );
  return nova.id;
}
