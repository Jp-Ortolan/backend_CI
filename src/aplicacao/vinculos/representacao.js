/**
 * Regras de representação usadas por mais de um caminho (aprovação de
 * solicitação, edição de governança pelo admin): designar alguém como titular,
 * suplente ou integrante, e encerrar um vínculo.
 *
 * Rodam dentro de uma transação já aberta, com a gestão declarada.
 */
import { ErroDeNegocio } from '@/dominio/erros.js';

/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Põe a pessoa na função. Quem ocupa hoje a função (titular ou suplente) sai
 * dela ANTES de o novo entrar: o índice vinculo_titular_unico não admite dois
 * titulares vigentes nem por um instante dentro da transação.
 *
 * @param {Transacao} tx
 * @param {string} instituicaoId
 * @param {{ alvo: 'titular'|'suplente'|'integrante'|'convidado', pessoaId: string,
 *           inicio?: string|null, cargo?: string|null, documentoId?: string|null,
 *           anterior?: 'encerrar'|'manter_como_integrante', motivo?: string|null,
 *           vinculoAnteriorId?: string|null }} o
 */
export async function designarRepresentacao(tx, instituicaoId, o) {
  const inicio = o.inicio ?? hoje();

  /** @type {string|null} */
  let anteriorId = null;
  /** @type {any} */
  let anterior = null;
  if (o.vinculoAnteriorId) {
    anterior = await tx.consultaUm(
      `select id, pessoa_id, data_inicio, status from vinculo where id = $1 and instituicao_id = $2`,
      [o.vinculoAnteriorId, instituicaoId]);
    if (!anterior) throw new ErroDeNegocio('VINCULO_INVALIDO', 'O vínculo indicado não é desta instituição.');
    if (anterior.status !== 'ativo') {
      throw new ErroDeNegocio('VINCULO_JA_ENCERRADO', 'O vínculo indicado já estava encerrado.');
    }
  } else if (o.alvo === 'titular' || o.alvo === 'suplente') {
    anterior = await tx.consultaUm(
      `select id, pessoa_id, data_inicio from vinculo
        where instituicao_id = $1 and status = 'ativo' and tipo_representacao = $2::tipo_representacao`,
      [instituicaoId, o.alvo]);
  }

  if (anterior && anterior.pessoa_id !== o.pessoaId) {
    anteriorId = anterior.id;
    if (o.anterior === 'manter_como_integrante') {
      await tx.consulta(
        `update vinculo set tipo_representacao = 'integrante', motivo_encerramento = null where id = $1`,
        [anterior.id]);
    } else {
      // A data de fim não pode ser anterior ao início do próprio vínculo.
      const fim = inicio < anterior.data_inicio ? anterior.data_inicio : inicio;
      await tx.consulta(
        `update vinculo set status = 'encerrado', data_fim = $2, motivo_encerramento = $3 where id = $1`,
        [anterior.id, fim, o.motivo ?? 'Substituído na representação']);
    }
  }

  // A pessoa já representa a instituição (era suplente e vira titular, por
  // exemplo): muda o tipo do vínculo que existe, sem abrir outro.
  const existente = await tx.consultaUm(
    `select id from vinculo where pessoa_id = $1 and instituicao_id = $2 and status = 'ativo'`,
    [o.pessoaId, instituicaoId]);

  let vinculoId;
  if (existente) {
    await tx.consulta(
      `update vinculo set tipo_representacao = $2::tipo_representacao,
              cargo = coalesce($3, cargo),
              oficio_documento_id = coalesce($4, oficio_documento_id)
        where id = $1`,
      [existente.id, o.alvo, o.cargo ?? null, o.documentoId ?? null]);
    vinculoId = existente.id;
  } else {
    const novo = await tx.consultaUm(
      `insert into vinculo (pessoa_id, instituicao_id, cargo, data_inicio,
                            tipo_representacao, oficio_documento_id)
       values ($1, $2, $3, $4, $5::tipo_representacao, $6) returning id`,
      [o.pessoaId, instituicaoId, o.cargo ?? null, inicio, o.alvo, o.documentoId ?? null]);
    vinculoId = novo.id;
  }

  return { pessoaId: o.pessoaId, vinculoId, tipoRepresentacao: o.alvo, vinculoAnteriorId: anteriorId };
}

/**
 * Encerra um vínculo da instituição, com motivo.
 *
 * @param {Transacao} tx
 * @param {string} instituicaoId
 * @param {string} vinculoId
 * @param {{ dataFim?: string|null, motivo: string|null }} o
 */
export async function encerrarVinculoDaInstituicao(tx, instituicaoId, vinculoId, o) {
  const v = await tx.consultaUm(
    `select id, data_inicio, status from vinculo where id = $1 and instituicao_id = $2`,
    [vinculoId, instituicaoId]);
  if (!v) throw new ErroDeNegocio('VINCULO_INVALIDO', 'O vínculo indicado não é desta instituição.');
  if (v.status === 'encerrado') {
    throw new ErroDeNegocio('VINCULO_JA_ENCERRADO', 'Este vínculo já estava encerrado.');
  }
  const fim = o.dataFim ?? hoje();
  if (fim < v.data_inicio) {
    throw new ErroDeNegocio('DATA_FIM_ANTERIOR_AO_INICIO',
      `A data de encerramento não pode ser anterior a ${v.data_inicio}.`);
  }
  await tx.consulta(
    `update vinculo set status = 'encerrado', data_fim = $2, motivo_encerramento = $3 where id = $1`,
    [v.id, fim, o.motivo]);
  return { vinculoId: v.id, dataFim: fim };
}

/**
 * A pessoa que assume: a indicada por id, ou uma nova com os dados do pedido.
 * Reaproveita quem já tem o mesmo CPF ou e-mail (a pessoa é uma só, os
 * vínculos é que mudam) ou, sem CPF e e-mail, quem tem o MESMO NOME entre os
 * vínculos desta instituição. Nunca casa por nome com pessoa de fora dela:
 * dois "João Silva" de instituições diferentes não são a mesma pessoa.
 *
 * @param {Transacao} tx
 * @param {string} instituicaoId
 * @param {{ pessoaId?: string|null, pessoa?: { nome: string, cpf?: string|null,
 *           email?: string|null, telefone?: string|null }|null }} d
 * @returns {Promise<string>}
 */
export async function resolverPessoa(tx, instituicaoId, d) {
  if (d.pessoaId) {
    const p = await tx.consultaUm('select id from pessoa where id = $1', [d.pessoaId]);
    if (!p) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Pessoa indicada não encontrada.');
    return p.id;
  }
  const n = d.pessoa;
  if (!n?.nome) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe a pessoa indicada.');

  if (n.cpf || n.email) {
    const existente = await tx.consultaUm(
      `select id from pessoa
        where ($1::text is not null and cpf = $1)
           or ($2::text is not null and email = $2)
        order by (cpf = $1) desc nulls last limit 1`,
      [n.cpf ?? null, n.email ?? null]);
    if (existente) return existente.id;
  } else {
    const mesmoNome = await tx.consultaUm(
      `select p.id from pessoa p join vinculo v on v.pessoa_id = p.id
        where v.instituicao_id = $1
          and imutavel_unaccent(lower(p.nome)) = imutavel_unaccent(lower($2))
        order by (v.status = 'ativo') desc limit 1`,
      [instituicaoId, n.nome.trim()]);
    if (mesmoNome) return mesmoNome.id;
  }

  const nova = await tx.consultaUm(
    `insert into pessoa (nome, cpf, email, telefone) values ($1, $2, $3, $4) returning id`,
    [n.nome.trim(), n.cpf ?? null, n.email ?? null, n.telefone ?? null]);
  return nova.id;
}
