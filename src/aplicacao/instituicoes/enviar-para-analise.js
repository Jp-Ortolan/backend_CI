/**
 * CASO DE USO — Enviar o cadastro da instituição para análise da Diretoria.
 *
 * É o único passo de situação que o representante dá: de rascunho,
 * aguardando documentos ou ajustes solicitados para "em análise". Só passa com
 * o cadastro completo — a lista do que falta vem de pendencias.js, a mesma que
 * a tela mostra.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, exigirInstituicaoPropria } from '@/aplicacao/guarda.js';
import { EM_PREENCHIMENTO, ROTULO_STATUS_INSTITUICAO } from './esquemas.js';
import { pendenciasDoCadastro } from './pendencias.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} instituicaoId
 */
export async function enviarParaAnalise(usuario, instituicaoId) {
  const u = exigir(usuario, 'instituicao', 'editar');
  exigirInstituicaoPropria(u, instituicaoId);

  return comUsuario(u.id, async (tx) => {
    const i = await tx.consultaUm('select id, nome, status from instituicao where id = $1',
      [instituicaoId]);
    if (!i) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    if (!EM_PREENCHIMENTO.includes(i.status)) {
      throw new ErroDeNegocio('TRANSICAO_INVALIDA',
        `O cadastro está "${ROTULO_STATUS_INSTITUICAO[i.status]}" e não pode ser enviado para análise.`,
        { status: i.status });
    }

    const pendencias = await pendenciasDoCadastro(tx, instituicaoId);
    if (!pendencias.completo) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'O cadastro ainda tem pendências. Complete os itens indicados e envie de novo.',
        { campos: pendencias.itens, pendencias: pendencias.itens });
    }

    let linha;
    try {
      linha = await tx.consultaUm(
        `update instituicao set status = 'em_analise', updated_by = $2
          where id = $1 returning id, status`,
        [instituicaoId, u.id],
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }
    if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Não foi possível enviar o cadastro.');

    await tx.consulta('select notificar_gestao($1, $2, $3)', [
      'Cadastro enviado para análise', i.nome, `/instituicoes/${i.id}`,
    ]);

    return { id: linha.id, status: linha.status };
  });
}
