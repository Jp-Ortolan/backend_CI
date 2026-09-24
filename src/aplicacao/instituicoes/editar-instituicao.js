/**
 * CASO DE USO — Editar instituição (RF07).
 *
 * Tela "Editar instituição". Aceita o formulário inteiro ou só os campos que
 * mudaram: o que não vier no corpo não é tocado.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaEditar, paraColunas } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 * @returns {Promise<{ id: string, nome: string, status: string }>}
 */
export async function editarInstituicao(usuario, id, entrada) {
  const u = exigir(usuario, 'instituicao', 'editar');
  const dados = validar(esquemaEditar, entrada ?? {});

  const colunas = paraColunas(dados);
  if (Object.keys(colunas).length === 0) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');
  }

  colunas.updated_by = u.id;

  const campos = Object.keys(colunas);
  const atribuicoes = campos.map((c, n) => `${c} = $${n + 2}`);

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      'select id, status, data_saida from instituicao where id = $1', [id],
    );
    if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

// A constraint instituicao_inativa_tem_saida já barraria isso no banco.
// A checagem aqui existe para dizer QUAL campo falta.
    const statusFinal = colunas.status ?? atual.status;
    const saidaFinal = 'data_saida' in colunas ? colunas.data_saida : atual.data_saida;
    if (statusFinal === 'inativa' && !saidaFinal) {
      throw new ErroDeNegocio('DATA_SAIDA_OBRIGATORIA',
        'Para inativar a instituição é preciso informar a data de saída.');
    }

    let linha;
    try {
      linha = await tx.consultaUm(
        `update instituicao set ${atribuicoes.join(', ')}
          where id = $1
      returning id, nome, status`,
        [id, ...Object.values(colunas)],
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }

// Sem política de UPDATE o Postgres não levanta erro: não enxerga a linha e
// afeta zero registros. Sem este if, o perfil de consulta veria salvo com sucesso.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite editar esta instituição.');
    }

    return { id: linha.id, nome: linha.nome, status: linha.status };
  });
}
