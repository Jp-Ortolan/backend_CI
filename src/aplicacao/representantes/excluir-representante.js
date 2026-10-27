/**
 * CASO DE USO — Excluir representante (cadastro feito por engano).
 *
 * Só o admin ("excluir registros definitivamente"). Quem já participou de
 * reunião não se exclui: encerra-se o vínculo e o histórico fica — a trigger
 * da migration 012 recusa no banco mesmo que esta camada seja contornada.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} pessoaId
 */
export async function excluirRepresentante(usuario, pessoaId) {
  const u = exigir(usuario, 'representante', 'excluir');

  return comUsuario(u.id, async (tx) => {
    const p = await tx.consultaUm(
      `select p.id, p.nome,
              (select count(*) from presenca pr where pr.pessoa_id = p.id) as presencas,
              exists (select 1 from usuario us where us.pessoa_id = p.id) as tem_conta
         from pessoa p where p.id = $1`,
      [pessoaId],
    );
    if (!p) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Representante não encontrado.');

    if (Number(p.presencas) > 0) {
      throw new ErroDeNegocio('PESSOA_COM_HISTORICO',
        `${p.nome} tem ${p.presencas} registro(s) de presença e não pode ser excluído(a). `
        + 'Encerre o vínculo — o histórico continua preservado.',
        { presencas: Number(p.presencas), acaoSugerida: 'encerrar_vinculo' });
    }
    if (p.tem_conta) {
      throw new ErroDeNegocio('PESSOA_COM_HISTORICO',
        `${p.nome} tem uma conta de acesso ao sistema. Desative a conta antes de excluir.`,
        { acaoSugerida: 'desativar_conta' });
    }

    let linha;
    try {
      linha = await tx.consultaUm('delete from pessoa where id = $1 returning id', [pessoaId]);
    } catch (e) {
      traduzirErroDoBanco(e);
    }
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Apenas o administrador pode excluir representantes.');
    }
    return { id: linha.id, excluido: /** @type {true} */ (true) };
  });
}
