/**
 * CASO DE USO — Cancelar, reabrir ou iniciar uma reunião.
 *
 * O encerramento NÃO passa por aqui: ele tem regra própria (marcar os ausentes,
 * fechar o denominador dos indicadores) e vive em encerrar-reuniao.js.
 *
 * Cancelar é o caminho para a reunião que não vai acontecer. Ela continua
 * existindo, com os convites e o histórico — some da agenda, não da base.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaStatusReuniao } from './esquemas.js';

/** Para onde cada situação pode ir. Fora disto, não passa. */
const TRANSICOES = {
  agendada: ['em_andamento', 'cancelada'],
  em_andamento: ['agendada', 'cancelada'],
  cancelada: ['agendada'],
  // Reunião encerrada não volta atrás por aqui: os ausentes já foram gravados,
  // e reabrir sem desfazê-los deixaria o indicador contando gente duas vezes.
  encerrada: [],
};

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 */
export async function alterarStatusReuniao(usuario, id, entrada) {
  const u = exigir(usuario, 'reuniao', 'editar');
  const { status, motivo } = validar(esquemaStatusReuniao, entrada);

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      'select id, status, titulo from reuniao where id = $1', [id],
    );
    if (!atual) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');

    if (atual.status === status) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', `A reunião já está "${status}".`);
    }

    const permitidas = TRANSICOES[/** @type {keyof TRANSICOES} */ (atual.status)] ?? [];
    if (!permitidas.includes(status)) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        atual.status === 'encerrada'
          ? 'Reunião encerrada não pode mudar de situação: as presenças e as '
            + 'ausências já foram registradas.'
          : `Não é possível ir de "${atual.status}" para "${status}".`);
    }

    const linha = await tx.consultaUm(
      `update reuniao
          set status = $2::status_reuniao,
              pauta = case when $3::text is null then pauta
                           else coalesce(pauta || E'\n', '') || $3 end
        where id = $1
    returning id, status`,
      [id, status, motivo ?? null],
    );

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Seu perfil não permite alterar a situação da reunião.');
    }

    return { id: linha.id, status: linha.status };
  });
}
