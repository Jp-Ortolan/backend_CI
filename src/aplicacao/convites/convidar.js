/**
 * CASO DE USO — Convidar representantes para uma reunião.
 *
 * Dois modos, porque a tela precisa dos dois:
 *   em massa    — todos os vínculos ativos de instituições ativas
 *   individual  — uma lista de vínculos escolhidos a dedo
 *
 * Convite não é presença: confirmar não registra comparecimento
 * (ver docs/07-alinhamento-modelo-front.md).
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

export const esquemaConvite = z.object({
  // Sem vinculoIds, convida todo mundo que está ativo.
  vinculoIds: z.array(z.string().uuid()).min(1).max(500).optional(),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} reuniaoId
 * @param {unknown} entrada
 */
export async function convidar(usuario, reuniaoId, entrada) {
  const u = exigir(usuario, 'presenca', 'criar');
  const { vinculoIds } = validar(esquemaConvite, entrada ?? {});

  return comUsuario(u.id, async (tx) => {
    const r = await tx.consultaUm(
      'select id, status, titulo from reuniao where id = $1', [reuniaoId],
    );
    if (!r) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');
    if (r.status === 'cancelada') {
      throw new ErroDeNegocio('REUNIAO_CANCELADA',
        'Esta reunião foi cancelada. Reative-a antes de convidar.');
    }
    if (r.status === 'encerrada') {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'A reunião já foi encerrada. Convidar agora não muda o que aconteceu.');
    }

    let inseridos = 0;

    if (!vinculoIds) {
      // A função do banco já cuida de não duplicar nem apagar resposta dada,
      // então clicar duas vezes no botão é seguro.
      const total = await tx.consultaUm(
        'select convidar_representantes_ativos($1) as total', [r.id],
      );
      inseridos = Number(total?.total ?? 0);
    } else {
      let linhas;
      try {
        linhas = await tx.consulta(
          `insert into reuniao_convite
                 (reuniao_id, vinculo_id, pessoa_id, instituicao_id, created_by)
           select $1, v.id, v.pessoa_id, v.instituicao_id, $3
             from vinculo v
            where v.id = any($2::uuid[])
              and v.status = 'ativo'
           on conflict (reuniao_id, vinculo_id) do nothing
             returning id`,
          [r.id, vinculoIds, u.id],
        );
      } catch (e) {
        traduzirErroDoBanco(e);
      }
      inseridos = linhas?.length ?? 0;
    }

    const resumo = await tx.consultaUm(
      `select convites_enviados, confirmados
         from vw_resumo_reuniao where reuniao_id = $1`, [r.id],
    );

    return {
      reuniaoId: r.id,
      convidadosAgora: inseridos,
// Devolve os dois números: a diferença são vínculos já convidados ou
// encerrados, e a tela diz isso em vez de parecer falha.
      convitesEnviados: Number(resumo?.convites_enviados ?? 0),
      confirmados: Number(resumo?.confirmados ?? 0),
    };
  });
}
