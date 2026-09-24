/**
 * CASO DE USO — Editar reunião.
 *
 * Aceita o formulário inteiro ou só os campos alterados.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaEditarReuniao, paraColunasReuniao } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 */
export async function editarReuniao(usuario, id, entrada) {
  const u = exigir(usuario, 'reuniao', 'editar');
  const dados = validar(esquemaEditarReuniao, entrada ?? {});

  const colunas = paraColunasReuniao(dados);
  if (Object.keys(colunas).length === 0) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');
  }

  const campos = Object.keys(colunas);
  const atribuicoes = campos.map((c, n) => `${c} = $${n + 2}`);

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      'select id, status, data from reuniao where id = $1', [id],
    );
    if (!atual) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');

// Reunião encerrada já fechou o denominador dos indicadores: mudar a data agora
// reescreveria participação passada.
    if (atual.status === 'encerrada' && ('data' in colunas || 'hora_inicio' in colunas)) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'A reunião já foi encerrada. Data e horário não podem mais mudar, '
        + 'porque os indicadores de participação já foram calculados sobre eles.');
    }
    if (atual.status === 'cancelada') {
      throw new ErroDeNegocio('REUNIAO_CANCELADA',
        'Esta reunião foi cancelada. Reative-a antes de editar.');
    }

    let linha;
    try {
      linha = await tx.consultaUm(
        `update reuniao set ${atribuicoes.join(', ')}
          where id = $1
      returning id, titulo, data, status`,
        [id, ...Object.values(colunas)],
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    // Sem política de UPDATE o PostgreSQL não levanta erro: não enxerga a linha
    // e afeta zero registros, em silêncio.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite editar reuniões.');
    }

    return {
      id: linha.id, titulo: linha.titulo, data: linha.data, status: linha.status,
    };
  });
}
