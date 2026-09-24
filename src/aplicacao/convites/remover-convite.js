/**
 * CASO DE USO — Remover um convite.
 *
 * Convite é intenção, não fato: pode ser apagado sem reescrever o que aconteceu.
 * Se a pessoa já compareceu, a presença continua — ela passa a constar como quem
 * apareceu sem convite.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} conviteId
 */
export async function removerConvite(usuario, conviteId) {
  const u = exigir(usuario, 'presenca', 'editar');

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      `select c.id, c.reuniao_id, r.status as status_reuniao
         from reuniao_convite c
         join reuniao r on r.id = c.reuniao_id
        where c.id = $1`,
      [conviteId],
    );
    if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Convite não encontrado.');

    if (atual.status_reuniao === 'encerrada') {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'A reunião já foi encerrada. Remover o convite agora mudaria o número '
        + 'de convidados de um evento que já aconteceu.');
    }

    // A política de DELETE da tabela é "só admin". Gestor cai no returning
    // vazio, sem exceção nenhuma do banco — por isso a checagem é aqui.
    const linha = await tx.consultaUm(
      'delete from reuniao_convite where id = $1 returning id', [conviteId],
    );

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Apenas o administrador pode remover convites.');
    }

    return { id: linha.id, removido: /** @type {true} */ (true) };
  });
}
