/**
 * CASO DE USO — Remover documento.
 *
 * Diferente de presença e vínculo, documento pode sumir: não sustenta indicador
 * nenhum. Só administrador, seguindo a matriz de permissões.
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

// Explícito mesmo com o cascade: com armazenamento externo o banco não apagaria
// o objeto, e a ordem certa (conteúdo, depois metadado) já fica escrita.
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
