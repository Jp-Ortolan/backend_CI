/**
 * CASO DE USO — Excluir instituição.
 *
 * Só para o cadastro criado por engano. Instituição que já participou de reunião
 * não se exclui, se desativa: a trigger instituicao_protege_historico
 * (migration 002) recusa mesmo se esta camada fosse contornada. A checagem aqui
 * existe para dar mensagem útil e contar quantos registros impedem.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @returns {Promise<{ id: string, excluida: true }>}
 */
export async function excluirInstituicao(usuario, id) {
  const u = exigir(usuario, 'instituicao', 'excluir');

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      `select i.id, i.nome,
              (select count(*) from presenca p where p.instituicao_id = i.id) as presencas,
              (select count(*) from vinculo  v where v.instituicao_id = i.id) as vinculos
         from instituicao i where i.id = $1`,
      [id],
    );
    if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    if (Number(atual.presencas) > 0) {
      throw new ErroDeNegocio(
        'INSTITUICAO_COM_HISTORICO',
        `"${atual.nome}" já participou de reuniões e não pode ser excluída. `
        + 'Você pode desativá-la, e todo o histórico continua preservado.',
        { presencas: Number(atual.presencas), acaoSugerida: 'desativar' },
      );
    }

    if (Number(atual.vinculos) > 0) {
      throw new ErroDeNegocio(
        'INSTITUICAO_COM_VINCULO',
        `"${atual.nome}" tem ${atual.vinculos} representante(s) vinculado(s). `
        + 'Encerre os vínculos antes de excluir, ou desative a instituição.',
        { vinculos: Number(atual.vinculos), acaoSugerida: 'desativar' },
      );
    }

    let linha;
    try {
      linha = await tx.consultaUm('delete from instituicao where id = $1 returning id', [id]);
    } catch (e) {
      // Se algo entrou entre a contagem acima e o delete, a trigger pega.
      traduzirErroDoBanco(e);
    }

// DELETE sem política afeta zero linhas em silêncio. Sem este if, o gestor veria
// excluída com sucesso e ela voltaria no F5.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Apenas o administrador pode excluir instituições.');
    }

    return { id: linha.id, excluida: /** @type {true} */ (true) };
  });
}
