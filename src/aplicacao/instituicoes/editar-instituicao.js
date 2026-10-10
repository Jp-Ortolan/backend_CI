/**
 * CASO DE USO — Editar instituição (RF07).
 *
 * Tela "Editar instituição". Aceita o formulário inteiro ou só os campos que
 * mudaram: o que não vier no corpo não é tocado.
 *
 * Revisão de outubro — o representante também edita, com duas travas:
 *   1. só a PRÓPRIA instituição;
 *   2. só os campos de contato (CAMPOS_LIVRES_REPRESENTANTE). Nome, CNPJ,
 *      classificação e GTs viram solicitação — a resposta diz isso e lista os
 *      campos, para a tela oferecer "Enviar para aprovação".
 *      Enquanto a instituição ainda está se cadastrando (rascunho, aguardando
 *      documentos, ajustes solicitados), não há o que proteger e ela preenche
 *      tudo, menos o que é decisão da Diretoria.
 * A trigger da migration 008 repete as duas regras no banco.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao, pode } from '@/dominio/permissoes.js';
import { TRANSICOES_INSTITUICAO } from './alterar-status-instituicao.js';
import { exigir, exigirInstituicaoPropria, validar } from '@/aplicacao/guarda.js';
import {
  esquemaEditar, paraColunas, gravarGruposDaInstituicao,
  CAMPOS_LIVRES_REPRESENTANTE, CAMPOS_DA_GESTAO, EM_PREENCHIMENTO,
} from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 * @returns {Promise<{ id: string, nome: string, status: string }>}
 */
export async function editarInstituicao(usuario, id, entrada) {
  const u = exigir(usuario, 'instituicao', 'editar');
  exigirInstituicaoPropria(u, id);
  const dados = validar(esquemaEditar, entrada ?? {});

  const gestao = ehGestao(u.papel);

  const statusPedido = dados.status;
  delete dados.status;

  const colunas = paraColunas(dados);
  const mudaGrupos = Array.isArray(dados.grupoTrabalhoIds);
  if (Object.keys(colunas).length === 0 && !mudaGrupos && !statusPedido) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');
  }

  colunas.updated_by = u.id;

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      'select id, status, data_saida from instituicao where id = $1', [id],
    );
    if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    // A situação tem rota própria (alterar-status), com transições e histórico.
    // O formulário de edição costuma mandar o status junto com o resto:
    //   o mesmo de antes  → ignorado;
    //   outro, pela gestão → vale, desde que seja um passo permitido do fluxo
    //                        (o mesmo mapa da rota de situação);
    //   outro, pelo representante → recusado (a trigger da 008 recusaria também).
    if (statusPedido && statusPedido !== atual.status) {
      const permitidas = TRANSICOES_INSTITUICAO[
        /** @type {keyof typeof TRANSICOES_INSTITUICAO} */ (atual.status)] ?? [];
      if (!gestao) {
        throw new ErroDeNegocio('ALTERACAO_EXIGE_APROVACAO',
          'A situação da instituição é decidida pela Diretoria.',
          { campos: [{ campo: 'status', mensagem: 'Exige aprovação.' }] });
      }
      if (!permitidas.includes(statusPedido)) {
        throw new ErroDeNegocio('TRANSICAO_INVALIDA',
          `Não é possível ir de "${atual.status}" para "${statusPedido}".`,
          { de: atual.status, para: statusPedido, permitidas });
      }
      if (statusPedido === 'ativa' && !pode(u.papel, 'instituicao', 'aprovar')) {
        throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não aprova a entrada de instituições.');
      }
      colunas.status = statusPedido;
    }

    if (!gestao) {
      const preenchendo = EM_PREENCHIMENTO.includes(atual.status);
      const enviados = Object.keys(dados);

      const daGestao = enviados.filter((c) => CAMPOS_DA_GESTAO.includes(c));
      const sensiveis = preenchendo
        ? daGestao
        : enviados.filter((c) => !CAMPOS_LIVRES_REPRESENTANTE.includes(c));
      // GTs são decididos pela Diretoria em qualquer fase.
      if (mudaGrupos && !sensiveis.includes('grupoTrabalhoIds')) sensiveis.push('grupoTrabalhoIds');

      if (sensiveis.length) {
        throw new ErroDeNegocio('ALTERACAO_EXIGE_APROVACAO',
          'Alguns campos precisam de aprovação da Diretoria. Envie uma solicitação '
          + 'de alteração com eles.',
          {
            campos: sensiveis.map((c) => ({ campo: c, mensagem: 'Exige aprovação.' })),
            acaoSugerida: 'solicitacao',
            tipoSolicitacao: 'alterar_dados',
          });
      }
    }

// A constraint instituicao_inativa_tem_saida já barraria isso no banco.
// A checagem aqui existe para dizer QUAL campo falta.
    const statusFinal = colunas.status ?? atual.status;
    const saidaFinal = 'data_saida' in colunas ? colunas.data_saida : atual.data_saida;
    if (['inativa', 'desligada'].includes(statusFinal) && !saidaFinal) {
      throw new ErroDeNegocio('DATA_SAIDA_OBRIGATORIA',
        'Instituição inativa ou desligada precisa da data de saída.');
    }

    const campos = Object.keys(colunas);
    const atribuicoes = campos.map((c, n) => `${c} = $${n + 2}`);

    let linha;
    try {
      linha = await tx.consultaUm(
        `update instituicao set ${atribuicoes.join(', ')}
          where id = $1
      returning id, nome, status`,
        [id, ...Object.values(colunas)],
      );
      if (linha && mudaGrupos) {
        await gravarGruposDaInstituicao(tx, id, dados.grupoTrabalhoIds);
      }
    } catch (e) {
      traduzirErroDoBanco(e);
    }

// Sem política de UPDATE o Postgres não levanta erro: não enxerga a linha e
// afeta zero registros. Sem este if, quem não pode veria salvo com sucesso.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite editar esta instituição.');
    }

    return { id: linha.id, nome: linha.nome, status: linha.status };
  });
}
