/**
 * CASO DE USO — Remover documento.
 *
 * Documento pode ser removido, diferente de presença e de vínculo: ele não
 * sustenta indicador nenhum, e anexo trocado por engano é comum.
 *
 * Só administrador, seguindo a matriz de permissões — a mesma regra que impede
 * gestor de excluir instituição.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { remover } from '@/infraestrutura/armazenamento/index.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 */
export async function removerDocumento(usuario, id) {
  const u = exigir(usuario, 'documento', 'excluir');

  return comUsuario(u.id, async (tx) => {
    const d = await tx.consultaUm(
      'select id, nome, storage_path from documento where id = $1', [id],
    );
    if (!d) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Documento não encontrado.');

    // Explícito, mesmo com o "on delete cascade" dando conta: com armazenamento
    // externo o banco não teria como apagar o objeto, e a ordem certa (apagar o
    // conteúdo, depois o metadado) fica escrita desde agora.
    await remover(tx, { documentoId: d.id, caminho: d.storage_path });

    const linha = await tx.consultaUm(
      'delete from documento where id = $1 returning id', [id],
    );

    // DELETE sem política não levanta erro: afeta zero linhas em silêncio.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Apenas o administrador pode remover documentos.');
    }

    return { id: linha.id, nome: d.nome, removido: /** @type {true} */ (true) };
  });
}
