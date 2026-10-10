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
  const analise = ESQUEMA_DADOS[pedido.tipo].safeParse(pedido.dados);
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

  return comUsuario(u.id, async (tx) => {
    const inst = await tx.consultaUm('select id, nome from instituicao where id = $1', [instituicaoId]);
    if (!inst) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    if (pedido.documentoId) {
      const doc = await tx.consultaUm(
        'select id from documento where id = $1 and instituicao_id = $2',
        [pedido.documentoId, instituicaoId]);
      if (!doc) {
        throw new ErroDeNegocio('NAO_ENCONTRADO',
          'O documento indicado não foi encontrado entre os documentos desta instituição.');
      }
    }

    // Correção de presença: a pessoa tem que ser da instituição que pede.
    // Sem isso, um representante pediria para mexer na presença de outra
    // instituição — a Diretoria até recusaria, mas o pedido nem deve existir.
    let reuniaoId = null;
    if (pedido.tipo === 'correcao_presenca') {
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
    }

    // Uma pendente de cada tipo de troca por vez: dois pedidos de troca de
    // titular abertos ao mesmo tempo deixariam a Diretoria sem saber qual vale.
    if (['troca_titular', 'troca_suplente', 'entrada_forum', 'saida_forum'].includes(pedido.tipo)) {
      const aberta = await tx.consultaUm(
        `select id from solicitacao
          where instituicao_id = $1 and tipo = $2::tipo_solicitacao and status = 'pendente'`,
        [instituicaoId, pedido.tipo]);
      if (aberta) {
        throw new ErroDeNegocio('DADOS_INVALIDOS',
          `Já existe uma solicitação de ${ROTULO_SOLICITACAO[pedido.tipo].toLowerCase()} `
          + 'aguardando a Diretoria. Cancele-a para abrir outra.',
          { solicitacaoId: aberta.id });
      }
    }

    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into solicitacao (instituicao_id, tipo, dados, justificativa,
                                  documento_id, reuniao_id, solicitado_por)
         values ($1, $2::tipo_solicitacao, $3, $4, $5, $6, $7)
         returning id, tipo, status, created_at`,
        [instituicaoId, pedido.tipo, JSON.stringify(dados), pedido.justificativa,
          pedido.documentoId ?? null, reuniaoId, u.id],
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
      `Nova solicitação: ${ROTULO_SOLICITACAO[pedido.tipo]}`, inst.nome,
      `/solicitacoes/${linha.id}`,
    ]);

    return {
      id: linha.id,
      tipo: linha.tipo,
      rotulo: ROTULO_SOLICITACAO[linha.tipo],
      status: linha.status,
      instituicaoId,
      criadaEm: linha.created_at,
    };
  });
}
