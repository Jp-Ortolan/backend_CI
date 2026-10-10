/**
 * CASO DE USO — Detalhe de uma solicitação, com o "antes" ao lado do pedido.
 *
 * Para a Diretoria decidir, não basta ver o que foi pedido: precisa ver o que
 * está gravado hoje. Para alteração de dados, a resposta traz os dois.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';
import { ROTULO_SOLICITACAO } from './esquemas.js';

/** Campo do pedido → coluna atual, para o quadro "antes / depois". */
const COLUNA = {
  nome: 'nome', razaoSocial: 'razao_social', nomeFantasia: 'nome_fantasia',
  cnpj: 'cnpj', dataFundacao: 'data_fundacao', tipoInstituicaoId: 'tipo_instituicao_id',
  areaAtuacaoId: 'area_atuacao_id', vertenteId: 'vertente_id',
};

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 */
export async function obterSolicitacao(usuario, id) {
  const u = exigir(usuario, 'solicitacao', 'ver');

  return comUsuario(u.id, async (tx) => {
    const s = await tx.consultaUm(
      `select s.*, i.nome as instituicao, autor.nome as solicitado_por_nome,
              analista.nome as analisado_por_nome, d.nome as documento_nome
         from solicitacao s
         join instituicao i on i.id = s.instituicao_id
         left join vw_usuario_publico autor    on autor.id = s.solicitado_por
         left join vw_usuario_publico analista on analista.id = s.analisado_por
         left join documento d on d.id = s.documento_id
        where s.id = $1`,
      [id],
    );
    if (!s) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Solicitação não encontrada.');

    /** @type {Record<string, {antes: unknown, depois: unknown}>|null} */
    let comparacao = null;
    if (s.tipo === 'alterar_dados') {
      const atual = await tx.consultaUm('select * from instituicao where id = $1', [s.instituicao_id]);
      comparacao = {};
      for (const [campo, depois] of Object.entries(s.dados?.campos ?? {})) {
        comparacao[campo] = {
          antes: COLUNA[campo] ? atual?.[COLUNA[campo]] ?? null : null,
          depois,
        };
      }
    }

    // Quem ocupa a função hoje, para a troca de titular/suplente.
    let ocupanteAtual = null;
    if (s.tipo === 'troca_titular' || s.tipo === 'troca_suplente') {
      ocupanteAtual = await tx.consultaUm(
        `select v.id as vinculo_id, p.nome, v.cargo, v.data_inicio
           from vinculo v join pessoa p on p.id = v.pessoa_id
          where v.instituicao_id = $1 and v.status = 'ativo'
            and v.tipo_representacao = $2::tipo_representacao`,
        [s.instituicao_id, s.tipo === 'troca_titular' ? 'titular' : 'suplente'],
      );
    }

    return {
      id: s.id,
      tipo: s.tipo,
      rotulo: ROTULO_SOLICITACAO[s.tipo],
      status: s.status,
      instituicaoId: s.instituicao_id,
      instituicao: s.instituicao,
      dados: s.dados,
      justificativa: s.justificativa,
      documento: s.documento_id ? { id: s.documento_id, nome: s.documento_nome } : null,
      reuniaoId: s.reuniao_id,
      solicitadoPor: s.solicitado_por_nome,
      criadaEm: s.created_at,
      analisadoPor: s.analisado_por_nome,
      analisadoEm: s.analisado_em,
      resposta: s.resposta,
      comparacao,
      ocupanteAtual: ocupanteAtual
        ? { vinculoId: ocupanteAtual.vinculo_id, nome: ocupanteAtual.nome,
          cargo: ocupanteAtual.cargo, desde: ocupanteAtual.data_inicio }
        : null,
    };
  });
}
