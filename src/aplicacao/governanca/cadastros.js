/**
 * Fichas de governança das instituições e dos representantes:
 *
 *   GET/PATCH /api/governanca/instituicoes/:id/governanca
 *   GET/PATCH /api/governanca/representantes/:id/governanca
 *
 * Complementam os formulários legados (não os substituem). Instituição: PATCH
 * só do admin; a Diretoria muda a ficha aprovando pedidos (contrato do front).
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { exigir } from '@/aplicacao/guarda.js';
import {
  lerRegistroInstituicao, aplicarRegistroInstituicao, compararInstituicao,
} from './instituicao-registro.js';
import { representacaoBanco, representacaoContrato } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */

/** Recusa a gravação se outra pessoa salvou depois que esta abriu a tela. */
function conferirVersao(enviada, atual) {
  if (enviada !== undefined && enviada !== null && enviada !== '' && Number(enviada) !== Number(atual)) {
    throw new ErroDeNegocio('VERSAO_DESATUALIZADA',
      'Este registro foi alterado por outra pessoa depois que você abriu a tela. '
      + 'Atualize a página e refaça a alteração.', { versaoAtual: Number(atual) });
  }
}

// ------------------------------------------------------------------ instituição

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 */
export async function obterGovernancaInstituicao(usuario, id) {
  const u = exigir(usuario, 'instituicao', 'ver');
  const registro = await comUsuario(u.id, (tx) => lerRegistroInstituicao(tx, id));
  // Representante consulta as outras instituições ("Consultar instituições e
  // logos"), mas sem lista nominal nem contato interno de outra instituição.
  if (ehGestao(u.papel) || u.instituicaoId === id) return registro;
  return {
    ...registro,
    contatosComunicacao: '',
    titular: '',
    suplente: '',
    motivoSaida: '',
    somenteConsulta: true,
  };
}

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {Record<string, any>} corpo  a ficha (inteira ou só o que mudou)
 */
export async function salvarGovernancaInstituicao(usuario, id, corpo) {
  const u = exigir(usuario, 'instituicao', 'editar');
  if (u.papel !== 'admin') {
    throw new ErroDeNegocio('ALTERACAO_EXIGE_APROVACAO',
      'Só o administrador geral edita a ficha diretamente. Alterações da instituição '
      + 'passam por solicitação e aprovação da Diretoria.', { acaoSugerida: 'solicitacao' });
  }
  const { versaoRegistro, id: _id, ...campos } = corpo ?? {};

  return comUsuario(u.id, async (tx) => {
    const atual = await lerRegistroInstituicao(tx, id);
    conferirVersao(versaoRegistro, atual.versaoRegistro);
    const mudancas = Object.fromEntries(compararInstituicao(atual, campos).map((c) => [c.campo, c.depois]));
    if (Object.keys(mudancas).length) {
      try {
        await aplicarRegistroInstituicao(tx, id, mudancas, u);
      } catch (e) {
        if (e instanceof ErroDeNegocio) throw e;
        traduzirErroDoBanco(e);
      }
    }
    return lerRegistroInstituicao(tx, id);
  });
}

// ---------------------------------------------------------------- representante

/**
 * A ficha de representação da pessoa: o vínculo vigente (ou o último).
 *
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {string} pessoaId
 */
async function lerRegistroRepresentante(tx, pessoaId) {
  const p = await tx.consultaUm('select id, nome, autoriza_comunicacao from pessoa where id = $1', [pessoaId]);
  if (!p) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Representante não encontrado.');

  const v = await tx.consultaUm(
    `select v.*, ve.nome as vertente_nome,
            coalesce((select string_agg(g.nome, ', ' order by g.nome)
                        from vinculo_grupo_trabalho vg join grupo_trabalho g on g.id = vg.grupo_trabalho_id
                       where vg.vinculo_id = v.id), '') as gts
       from vinculo v
       left join vertente ve on ve.id = v.vertente_id
      where v.pessoa_id = $1
      order by (v.status = 'ativo') desc, v.data_inicio desc
      limit 1`,
    [pessoaId]);
  const conta = await tx.consultaUm('select id from usuario where pessoa_id = $1', [pessoaId]).catch(() => null);

  return {
    id: p.id,
    vinculoId: v?.id ?? null,
    instituicaoId: v?.instituicao_id ?? null,
    tipo: v ? representacaoContrato(v.tipo_representacao) : '',
    cargoForum: v?.cargo_forum ?? '',
    vertente: v?.vertente_nome ?? '',
    gts: v?.gts ?? '',
    inicio: v?.data_inicio ?? '',
    fim: v?.data_fim ?? '',
    motivoSubstituicao: v?.motivo_encerramento ?? '',
    oficioId: v?.oficio_documento_id ?? '',
    usuarioId: conta?.id ?? '',
    autorizaComunicacoes: !!p.autoriza_comunicacao,
    versaoRegistro: v ? Number(v.versao_registro) : 1,
  };
}

/**
 * @param {Usuario|null} usuario
 * @param {string} pessoaId
 */
export async function obterGovernancaRepresentante(usuario, pessoaId) {
  const u = exigir(usuario, 'representante', 'ver');
  return comUsuario(u.id, (tx) => lerRegistroRepresentante(tx, pessoaId));
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {Usuario|null} usuario
 * @param {string} pessoaId
 * @param {Record<string, any>} corpo
 */
export async function salvarGovernancaRepresentante(usuario, pessoaId, corpo) {
  const u = exigir(usuario, 'vinculo', 'editar');
  if (!ehGestao(u.papel)) {
    throw new ErroDeNegocio('ALTERACAO_EXIGE_APROVACAO',
      'Mudanças na representação são pedidas à Diretoria pela área da instituição.');
  }
  const c = corpo ?? {};

  return comUsuario(u.id, async (tx) => {
    const atual = await lerRegistroRepresentante(tx, pessoaId);
    conferirVersao(c.versaoRegistro, atual.versaoRegistro);
    const muda = (k) => k in c && String(c[k] ?? '') !== String(atual[k] ?? '');

    /** @type {{ campo: string, mensagem: string }[]} */
    const erros = [];
    /** @type {Record<string, unknown>} */
    const col = {};

    const vinculoCampos = ['tipo', 'cargoForum', 'vertente', 'gts', 'inicio', 'fim', 'motivoSubstituicao', 'oficioId'];
    if (!atual.vinculoId && vinculoCampos.some(muda)) {
      throw new ErroDeNegocio('VINCULO_INVALIDO',
        'Esta pessoa não tem vínculo com nenhuma instituição. Crie o vínculo antes.');
    }

    if (muda('tipo')) {
      const t = representacaoBanco(String(c.tipo));
      if (!['titular', 'suplente', 'integrante', 'convidado'].includes(t)) {
        erros.push({ campo: 'tipo', mensagem: 'Tipo inválido: titular, suplente, adicional ou convidado.' });
      } else col.tipo_representacao = t;
    }
    if (muda('cargoForum')) col.cargo_forum = String(c.cargoForum ?? '').trim() || null;
    if (muda('vertente')) {
      const nome = String(c.vertente ?? '').trim();
      if (!nome) col.vertente_id = null;
      else {
        const ve = await tx.consultaUm(
          'select id from vertente where ativo and imutavel_unaccent(lower(nome)) = imutavel_unaccent(lower($1))', [nome]);
        if (!ve) erros.push({ campo: 'vertente', mensagem: 'Vertente não cadastrada.' });
        else col.vertente_id = ve.id;
      }
    }
    /** @type {number[]|null} */
    let gts = null;
    if (muda('gts')) {
      gts = [];
      for (const n of String(c.gts ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
        const g = await tx.consultaUm(
          'select id from grupo_trabalho where ativo and imutavel_unaccent(lower(nome)) = imutavel_unaccent(lower($1))', [n]);
        if (!g) erros.push({ campo: 'gts', mensagem: `GT "${n}" não cadastrado.` });
        else gts.push(Number(g.id));
      }
    }
    if (muda('inicio')) {
      if (!DATA.test(String(c.inicio))) erros.push({ campo: 'inicio', mensagem: 'Data de início inválida.' });
      else col.data_inicio = c.inicio;
    }
    if (muda('fim')) {
      const fim = String(c.fim ?? '').trim();
      if (!fim) erros.push({ campo: 'fim', mensagem: 'Vínculo encerrado não se reabre por aqui: crie um vínculo novo.' });
      else if (!DATA.test(fim)) erros.push({ campo: 'fim', mensagem: 'Data de encerramento inválida.' });
      else { col.data_fim = fim; col.status = 'encerrado'; }
    }
    const inicioFinal = String(col.data_inicio ?? atual.inicio);
    const fimFinal = String(col.data_fim ?? atual.fim ?? '');
    if (fimFinal && fimFinal < inicioFinal) {
      erros.push({ campo: 'fim', mensagem: 'O encerramento não pode ser antes do início.' });
    }
    if (muda('motivoSubstituicao')) col.motivo_encerramento = String(c.motivoSubstituicao ?? '').trim() || null;
    if (col.status === 'encerrado' && !col.motivo_encerramento && !atual.motivoSubstituicao) {
      erros.push({ campo: 'motivoSubstituicao', mensagem: 'Informe o motivo do encerramento.' });
    }
    if (muda('oficioId')) {
      const id = String(c.oficioId ?? '').trim();
      if (!id) col.oficio_documento_id = null;
      else {
        const doc = await tx.consultaUm(
          `select id from documento where id::text = $1 and instituicao_id = $2 and status_analise <> 'recusado'`,
          [id, atual.instituicaoId]);
        if (!doc) erros.push({ campo: 'oficioId', mensagem: 'Ofício não encontrado entre os documentos da instituição.' });
        else col.oficio_documento_id = doc.id;
      }
    }

    // Conta ligada: só o admin, e só conta de representante da MESMA instituição.
    let novaConta = null;
    if (muda('usuarioId')) {
      if (u.papel !== 'admin') erros.push({ campo: 'usuarioId', mensagem: 'Só o administrador liga contas.' });
      else if (c.usuarioId) {
        const conta = await tx.consultaUm('select id, papel, instituicao_id from usuario where id::text = $1', [String(c.usuarioId)]);
        if (!conta) erros.push({ campo: 'usuarioId', mensagem: 'Conta não encontrada.' });
        else if (conta.papel === 'representante' && conta.instituicao_id !== atual.instituicaoId) {
          erros.push({ campo: 'usuarioId', mensagem: 'A conta é de outra instituição.' });
        } else novaConta = conta.id;
      }
    }

    if (erros.length) throw new ErroDeNegocio('DADOS_INVALIDOS', erros[0].mensagem, { campos: erros });

    try {
      if (Object.keys(col).length) {
        const nomes = Object.keys(col);
        const casts = { tipo_representacao: '::tipo_representacao', status: '::status_vinculo' };
        await tx.consulta(
          `update vinculo set ${nomes.map((k, n) => `${k} = $${n + 2}${casts[k] ?? ''}`).join(', ')} where id = $1`,
          [atual.vinculoId, ...Object.values(col)]);
      }
      if (gts) {
        await tx.consulta('delete from vinculo_grupo_trabalho where vinculo_id = $1', [atual.vinculoId]);
        if (gts.length) {
          await tx.consulta(
            `insert into vinculo_grupo_trabalho (vinculo_id, grupo_trabalho_id)
             select $1, unnest($2::smallint[]) on conflict do nothing`, [atual.vinculoId, gts]);
        }
      }
      if (muda('autorizaComunicacoes')) {
        await tx.consulta('update pessoa set autoriza_comunicacao = $2 where id = $1',
          [pessoaId, c.autorizaComunicacoes === true || c.autorizaComunicacoes === 'true']);
      }
      if (muda('usuarioId')) {
        await tx.consulta('update usuario set pessoa_id = null where pessoa_id = $1', [pessoaId]);
        if (novaConta) await tx.consulta('update usuario set pessoa_id = $2 where id = $1', [novaConta, pessoaId]);
      }
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    return lerRegistroRepresentante(tx, pessoaId);
  });
}
