/**
 * CASO DE USO — Abrir uma solicitação de alteração (revisão de outubro).
 *
 * "Alterações mais sensíveis não devem substituir o dado imediatamente. Devem
 * gerar uma solicitação para aprovação da Diretoria ou do administrador."
 *
 * O representante abre para a própria instituição; a gestão pode abrir em nome
 * de qualquer uma (pedido que chegou por e-mail, por exemplo).
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao } from '@/dominio/permissoes.js';
import {
  exigir, exigirInstituicaoPropria, instituicaoDoRepresentante, validar,
} from '@/aplicacao/guarda.js';
import { esquemaCriarSolicitacao, ESQUEMA_DADOS, ROTULO_SOLICITACAO } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 */
export async function criarSolicitacao(usuario, entrada) {
  const u = exigir(usuario, 'solicitacao', 'criar');
  const pedido = validar(esquemaCriarSolicitacao, entrada ?? {});

  const instituicaoId = pedido.instituicaoId
    ?? (ehGestao(u.papel) ? null : instituicaoDoRepresentante(u));
  if (!instituicaoId) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe a instituição da solicitação.',
      { campos: [{ campo: 'instituicaoId', mensagem: 'Informe a instituição.' }] });
  }
  exigirInstituicaoPropria(u, instituicaoId);

  // O formato de `dados` depende do tipo. Os erros apontam o campo dentro de
  // dados (ex.: "dados.pessoa.cpf"), para a tela marcar o lugar certo.
  // Os tipos do contrato /api/governanca são abertos só por aquelas rotas, que
  // têm validação própria (aplicacao/governanca).
  const esquema = ESQUEMA_DADOS[pedido.tipo];
  if (!esquema) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      'Este tipo de solicitação é aberto pela área da instituição (/api/governanca).');
  }
  const analise = esquema.safeParse(pedido.dados);
  if (!analise.success) {
    const campos = analise.error.issues.map((i) => ({
      campo: ['dados', ...i.path].join('.'), mensagem: i.message,
    }));
    throw new ErroDeNegocio('DADOS_INVALIDOS', campos[0]?.mensagem ?? 'Dados inválidos.', { campos });
  }
  const dados = analise.data;

  if (pedido.tipo === 'novo_oficio' && !pedido.documentoId) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      'Anexe o ofício antes (POST /api/documentos com tipo "oficio") e informe o documentoId.',
      { campos: [{ campo: 'documentoId', mensagem: 'Anexe o ofício.' }] });
  }

  return comUsuario(u.id, (tx) => registrarSolicitacao(tx, u, {
    instituicaoId, tipo: pedido.tipo, dados, justificativa: pedido.justificativa,
    documentoId: pedido.documentoId ?? null,
  }));
}

/**
 * Grava a solicitação dentro de uma transação aberta: confere o documento, a
 * pessoa (correção de presença) e o pedido repetido, insere e avisa a gestão.
 * Usada pela rota legada e pelas rotas do contrato /api/governanca.
 *
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {{ id: string }} u
 * @param {{ instituicaoId: string, tipo: string, dados: Record<string, any>,
 *           justificativa: string|null, documentoId: string|null }} p
 */
export async function registrarSolicitacao(tx, u, p) {
  const { instituicaoId, dados } = p;
  const inst = await tx.consultaUm('select id, nome from instituicao where id = $1', [instituicaoId]);
  if (!inst) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

  if (p.documentoId) {
    const doc = await tx.consultaUm(
      'select id from documento where id = $1 and instituicao_id = $2',
      [p.documentoId, instituicaoId]);
    if (!doc) {
      throw new ErroDeNegocio('NAO_ENCONTRADO',
        'O documento indicado não foi encontrado entre os documentos desta instituição.');
    }
  }

  // Correção de presença: a pessoa tem que ser da instituição que pede.
  // Sem isso, um representante pediria para mexer na presença de outra
  // instituição — a Diretoria até recusaria, mas o pedido nem deve existir.
  let reuniaoId = null;
  if (p.tipo === 'correcao_presenca') {
    reuniaoId = dados.reuniaoId;
    const ok = await tx.consultaUm(
      `select 1 from reuniao r
         join vinculo v on v.pessoa_id = $2 and v.instituicao_id = $3
                       and v.data_inicio <= r.data
                       and (v.data_fim is null or v.data_fim >= r.data)
        where r.id = $1`,
      [dados.reuniaoId, dados.pessoaId, instituicaoId]);
    if (!ok) {
      throw new ErroDeNegocio('VINCULO_INVALIDO',
        'Esta pessoa não representava a instituição na data da reunião.');
    }
    const repetida = await tx.consultaUm(
      `select id from solicitacao
        where instituicao_id = $1 and tipo = 'correcao_presenca' and status = 'pendente'
          and dados->>'reuniaoId' = $2 and dados->>'pessoaId' = $3`,
      [instituicaoId, dados.reuniaoId, dados.pessoaId]);
    if (repetida) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'Já existe um pedido de correção desta presença aguardando a Diretoria.',
        { solicitacaoId: repetida.id });
    }
  }

  // Uma pendente de cada tipo de troca por vez: dois pedidos de troca de
  // titular abertos ao mesmo tempo deixariam a Diretoria sem saber qual vale.
  if (['troca_titular', 'troca_suplente', 'entrada_forum', 'saida_forum'].includes(p.tipo)) {
    const aberta = await tx.consultaUm(
      `select id from solicitacao
        where instituicao_id = $1 and tipo = $2::tipo_solicitacao and status = 'pendente'`,
      [instituicaoId, p.tipo]);
    if (aberta) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        `Já existe uma solicitação de ${ROTULO_SOLICITACAO[p.tipo].toLowerCase()} `
        + 'aguardando a Diretoria. Cancele-a para abrir outra.',
        { solicitacaoId: aberta.id });
    }
  }
  // Substituir ou encerrar o MESMO vínculo duas vezes ao mesmo tempo, não.
  if (['substituicao_representante', 'encerramento_representante'].includes(p.tipo)) {
    const aberta = await tx.consultaUm(
      `select id from solicitacao
        where instituicao_id = $1 and status = 'pendente'
          and tipo in ('substituicao_representante', 'encerramento_representante')
          and dados->>'representanteAnteriorId' = $2`,
      [instituicaoId, dados.representanteAnteriorId]);
    if (aberta) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'Já existe um pedido para este vínculo aguardando a Diretoria.', { solicitacaoId: aberta.id });
    }
  }

  let linha;
  try {
    linha = await tx.consultaUm(
      `insert into solicitacao (instituicao_id, tipo, dados, justificativa,
                                documento_id, reuniao_id, solicitado_por)
       values ($1, $2::tipo_solicitacao, $3, $4, $5, $6, $7)
       returning id, tipo, status, created_at, versao_registro`,
      [instituicaoId, p.tipo, JSON.stringify(dados), p.justificativa,
        p.documentoId ?? null, reuniaoId, u.id],
    );
  } catch (e) {
    traduzirErroDoBanco(e);
  }
  if (!linha) {
    throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite abrir esta solicitação.');
  }

  // Avisa a gestão no sino (função da migration 009: o representante não
  // cria notificação para os outros por conta própria).
  await tx.consulta('select notificar_gestao($1, $2, $3)', [
    `Nova solicitação: ${ROTULO_SOLICITACAO[p.tipo]}`, inst.nome, '/solicitacoes',
  ]);

  return {
    id: linha.id,
    tipo: linha.tipo,
    rotulo: ROTULO_SOLICITACAO[linha.tipo],
    status: linha.status,
    instituicaoId,
    criadaEm: linha.created_at,
    versaoRegistro: Number(linha.versao_registro),
  };
}
