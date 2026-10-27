/**
 * CASO DE USO — Aprovar ou recusar uma solicitação.
 *
 * Aprovar aplica a mudança (aplicar-solicitacao.js) na MESMA transação que
 * marca a solicitação como aprovada: ou as duas coisas acontecem, ou nenhuma.
 * Recusar só registra a resposta — o cadastro não muda.
 *
 * O representante é avisado no sino nos dois casos.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaDecisao, ROTULO_SOLICITACAO } from './esquemas.js';
import { aplicarSolicitacao } from './aplicar-solicitacao.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 */
export async function decidirSolicitacao(usuario, id, entrada) {
  const u = exigir(usuario, 'solicitacao', 'aprovar');
  const { decisao, resposta, versaoRegistro } = validar(esquemaDecisao, entrada ?? {});

  if (decisao === 'recusar' && !resposta) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      'Explique o motivo da recusa: a instituição precisa saber o que ajustar.',
      { campos: [{ campo: 'resposta', mensagem: 'Informe o motivo.' }] });
  }

  return comUsuario(u.id, async (tx) => {
    // "for update": duas pessoas da Diretoria clicando em aprovar ao mesmo
    // tempo não aplicam a troca de titular duas vezes.
    const s = await tx.consultaUm(
      'select * from solicitacao where id = $1 for update', [id]);
    if (!s) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Solicitação não encontrada.');
    if (s.status !== 'pendente') {
      throw new ErroDeNegocio('SOLICITACAO_JA_DECIDIDA',
        `Esta solicitação já está "${s.status}".`, { status: s.status });
    }
    if (versaoRegistro && Number(s.versao_registro) !== versaoRegistro) {
      throw new ErroDeNegocio('VERSAO_DESATUALIZADA',
        'Esta solicitação mudou desde que você abriu a tela. Atualize antes de decidir.',
        { versaoAtual: Number(s.versao_registro) });
    }

    /** @type {Record<string, unknown>|null} */
    let efeito = null;
    try {
      if (decisao === 'aprovar') efeito = await aplicarSolicitacao(tx, s, u);
      // Documento recusado não fica "em análise" para sempre: é marcado
      // recusado, e a instituição vê isso na lista dela.
      if (decisao === 'recusar' && s.tipo === 'aprovacao_documento') {
        await tx.consulta(`update documento set status_analise = 'recusado' where id = $1`,
          [s.dados?.documentoId ?? s.documento_id]);
      }

      await tx.consulta(
        `update solicitacao
            set status = $2::status_solicitacao, analisado_por = $3,
                analisado_em = now(), resposta = $4
          where id = $1`,
        [id, decisao === 'aprovar' ? 'aprovada' : 'recusada', u.id, resposta],
      );
    } catch (e) {
      if (e instanceof ErroDeNegocio) throw e;
      traduzirErroDoBanco(e);
    }

    // O representante que pediu fica sabendo pelo sino.
    if (s.solicitado_por && s.solicitado_por !== u.id) {
      await tx.consulta(
        `insert into notificacao (usuario_id, titulo, mensagem, link)
         values ($1, $2, $3, $4)`,
        [s.solicitado_por,
          `${ROTULO_SOLICITACAO[s.tipo]}: ${decisao === 'aprovar' ? 'aprovada' : 'recusada'}`,
          resposta, '/minha-instituicao'],
      );
    }

    return {
      id: s.id,
      status: decisao === 'aprovar' ? 'aprovada' : 'recusada',
      efeito,
    };
  });
}
