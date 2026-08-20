/**
 * CASO DE USO — Encerrar a reunião e fechar a lista de presença (RF39).
 *
 * É este passo que fecha o denominador dos indicadores: sem ele, quem faltou
 * simplesmente não existe no banco e o percentual de participação fica sempre
 * em 100%.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { pode } from '@/dominio/permissoes.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} reuniaoId
 * @returns {Promise<object>}
 */
export async function encerrarReuniao(usuario, reuniaoId) {
  if (!usuario) throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
  if (!pode(usuario.papel, 'reuniao', 'encerrar')) {
    throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite encerrar reuniões.');
  }

  return comUsuario(usuario.id, async (tx) => {
    const r = await tx.consultaUm(
      'select id, data, status from reuniao where id = $1', [reuniaoId],
    );
    if (!r) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');
    if (r.status === 'cancelada') {
      throw new ErroDeNegocio('REUNIAO_CANCELADA', 'Esta reunião foi cancelada.');
    }

    // Quem tinha vínculo válido NA DATA da reunião era esperado ali e não
    // registrou presença: entra como ausente, com o snapshot daquele vínculo.
    const ausentes = await tx.consulta(
      `insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id,
                             cargo_no_momento, tipo, status, origem, registrado_por)
       select $1, v.pessoa_id, v.id, v.instituicao_id, v.cargo,
              'representante', 'ausente', 'manual', $2
         from vinculo v
        where v.data_inicio <= $3
          and (v.data_fim is null or v.data_fim >= $3)
          and not exists (
            select 1 from presenca p
             where p.reuniao_id = $1 and p.pessoa_id = v.pessoa_id)
       returning id`,
      [r.id, usuario.id, r.data],
    );

    await tx.consulta(`update reuniao set status = 'encerrada' where id = $1`, [r.id]);

    const resumo = await tx.consultaUm(
      `select presentes, ausentes, convidados, percentual_presenca
         from vw_resumo_reuniao where reuniao_id = $1`, [r.id],
    );

    return {
      status: 'encerrada',
      presentes: Number(resumo?.presentes ?? 0),
      ausentesMarcados: ausentes.length,
      convidados: Number(resumo?.convidados ?? 0),
      percentualPresenca: resumo?.percentual_presenca ?? null,
    };
  });
}
