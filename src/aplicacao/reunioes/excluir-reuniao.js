/**
 * CASO DE USO — Excluir reunião.
 *
 * Só para a reunião marcada por engano. Presença e documento apontam para a
 * reunião com on delete cascade: sem a trigger da migration 003, este delete
 * levaria o histórico junto sem erro nenhum. Convite não impede — é intenção,
 * não fato.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 */
export async function excluirReuniao(usuario, id) {
  const u = exigir(usuario, 'reuniao', 'excluir');

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      `select r.id, r.titulo,
              (select count(*) from presenca  p where p.reuniao_id = r.id) as presencas,
              (select count(*) from documento d where d.reuniao_id = r.id) as documentos
         from reuniao r where r.id = $1`,
      [id],
    );
    if (!atual) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');

    if (Number(atual.presencas) > 0) {
      throw new ErroDeNegocio(
        'REUNIAO_COM_PRESENCA',
        `"${atual.titulo}" tem ${atual.presencas} registro(s) de presença e não pode `
        + 'ser excluída. Cancele a reunião — o histórico continua preservado.',
        { presencas: Number(atual.presencas), acaoSugerida: 'cancelar' },
      );
    }

    if (Number(atual.documentos) > 0) {
      throw new ErroDeNegocio(
        'REUNIAO_COM_DOCUMENTO',
        `"${atual.titulo}" tem ${atual.documentos} documento(s) anexado(s). `
        + 'Remova os documentos antes, ou cancele a reunião.',
        { documentos: Number(atual.documentos), acaoSugerida: 'cancelar' },
      );
    }

    let linha;
    try {
      linha = await tx.consultaUm('delete from reuniao where id = $1 returning id', [id]);
    } catch (e) {
      // Se entrou presença entre a contagem e o delete, a trigger pega.
      traduzirErroDoBanco(e);
    }

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Apenas o administrador pode excluir reuniões.');
    }

    return { id: linha.id, excluida: /** @type {true} */ (true) };
  });
}
