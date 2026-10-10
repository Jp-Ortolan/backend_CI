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
 * @param {'reuniao'|'evento'} [natureza]  quando vem da rota, confere se o id é mesmo daquela natureza
 */
export async function editarReuniao(usuario, id, entrada, natureza) {
  const u = exigir(usuario, natureza ?? 'reuniao', 'editar');
  const dados = validar(esquemaEditarReuniao, entrada ?? {});

  const colunas = paraColunasReuniao(dados);
  if (Object.keys(colunas).length === 0) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');
  }

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      'select id, status, data, natureza from reuniao where id = $1', [id],
    );
    if (!atual || (natureza && atual.natureza !== natureza)) {
      throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA',
        natureza === 'evento' ? 'Evento não encontrado.' : 'Reunião não encontrada.');
    }

    if ('tipo_atividade_id' in colunas && colunas.tipo_atividade_id) {
      const tipo = await tx.consultaUm(
        'select natureza from tipo_atividade where id = $1', [colunas.tipo_atividade_id]);
      if (!tipo || tipo.natureza !== atual.natureza) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', 'Tipo de atividade de outra natureza.',
          { campos: [{ campo: 'tipoAtividadeId', mensagem: 'Tipo de outra natureza.' }] });
      }
    }

    // 'status' pelo PATCH só serve para publicar o rascunho; o resto passa pela
    // rota de situação, que tem as transições.
    if ('status' in colunas && colunas.status !== atual.status
      && !(atual.status === 'rascunho' && colunas.status === 'agendada')) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'A situação muda pela rota de situação (POST /status) ou pelo encerramento.');
    }
    if ('status' in colunas && colunas.status === atual.status) delete colunas.status;

// Reunião encerrada já fechou o denominador dos indicadores: mudar a data agora
// reescreveria participação passada.
    if (atual.status === 'encerrada'
      && ('data' in colunas || 'hora_inicio' in colunas || 'conta_participacao' in colunas)) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'A reunião já foi encerrada. Data, horário e "conta para o percentual" não '
        + 'podem mais mudar, porque os indicadores de participação já foram '
        + 'calculados sobre eles.');
    }
    if (atual.status === 'cancelada') {
      throw new ErroDeNegocio('REUNIAO_CANCELADA',
        'Esta reunião foi cancelada. Reative-a antes de editar.');
    }

    const campos = Object.keys(colunas);
    if (!campos.length) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');
    }
    const atribuicoes = campos.map((c, n) => `${c} = $${n + 2}`);

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
