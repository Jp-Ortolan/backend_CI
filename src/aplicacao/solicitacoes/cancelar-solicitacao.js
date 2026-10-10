/**
 * CASO DE USO — Cancelar a própria solicitação, enquanto está pendente.
 *
 * Cancelar não apaga: o pedido fica no histórico como "cancelada".
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 */
export async function cancelarSolicitacao(usuario, id) {
  const u = exigir(usuario, 'solicitacao', 'encerrar');

  return comUsuario(u.id, async (tx) => {
    const s = await tx.consultaUm('select id, status from solicitacao where id = $1', [id]);
    if (!s) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Solicitação não encontrada.');
    if (s.status !== 'pendente') {
      throw new ErroDeNegocio('SOLICITACAO_JA_DECIDIDA',
        `Esta solicitação já está "${s.status}" e não pode ser cancelada.`);
    }
    const linha = await tx.consultaUm(
      `update solicitacao set status = 'cancelada' where id = $1 returning id, status`, [id]);
    if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Você não pode cancelar esta solicitação.');
    return { id: linha.id, status: linha.status };
  });
}
