/**
 * CASO DE USO — Marcar presença ou ausência à mão (RF37, RF38).
 *
 * O QR cobre o caso normal; este cobre o resto, que acontece toda reunião:
 * celular sem bateria, atrasado que ninguém escaneou, justificativa por e-mail.
 * A presença é igual à do QR em tudo que importa — mesmo snapshot de vínculo,
 * mesma entrada nos indicadores; muda `origem = 'manual'` e `registrado_por`.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

export const esquemaMarcacao = z.object({
  pessoaId: z.string().uuid('Selecione o participante.'),
  status: z.enum(['presente', 'ausente', 'justificado'], {
    errorMap: () => ({ message: 'Situação inválida. Use presente, ausente ou justificado.' }),
  }),
  observacoes: z.string().trim().max(500).optional().transform((v) => (v || null)),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} reuniaoId
 * @param {unknown} entrada
 */
export async function marcarPresenca(usuario, reuniaoId, entrada) {
  const u = exigir(usuario, 'presenca', 'editar');
  const d = validar(esquemaMarcacao, entrada);

  return comUsuario(u.id, async (tx) => {
    const r = await tx.consultaUm(
      'select id, data, status from reuniao where id = $1', [reuniaoId],
    );
    if (!r) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');
    if (r.status === 'cancelada') {
      throw new ErroDeNegocio('REUNIAO_CANCELADA',
        'Esta reunião foi cancelada. Não há presença a registrar.');
    }

    const pessoa = await tx.consultaUm(
      'select id, nome from pessoa where id = $1', [d.pessoaId],
    );
    if (!pessoa) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Participante não encontrado.');

// O vínculo válido NA DATA da reunião, não o de hoje: mesma regra da função
// checkin_registrar (decisão de modelagem 2).
    const v = await tx.consultaUm(
      `select id, instituicao_id, cargo from vinculo
        where pessoa_id = $1
          and data_inicio <= $2
          and (data_fim is null or data_fim >= $2)
        order by (status = 'ativo') desc, data_inicio desc
        limit 1`,
      [d.pessoaId, r.data],
    );
    if (!v) {
      throw new ErroDeNegocio('VINCULO_INVALIDO',
        `${pessoa.nome} não tinha vínculo institucional na data desta reunião `
        + `(${r.data}). Registre como convidado pelo check-in, ou crie o vínculo antes.`);
    }

// A constraint presenca_presente_tem_horario exige horário só em 'presente':
// ausente e justificado não chegaram, gravar agora seria inventar dado.
    const horario = d.status === 'presente' ? new Date().toISOString() : null;

    let linha;
    try {
// A pessoa pode já ter linha: check-in corrigido, ausência desfeita. O upsert
// usa a constraint presenca_pessoa_unica (reuniao_id, pessoa_id).
      linha = await tx.consultaUm(
        `insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id,
                               cargo_no_momento, tipo, status, origem,
                               horario_checkin, observacoes, registrado_por)
              values ($1, $2, $3, $4, $5, 'representante', $6::status_presenca,
                      'manual', $7, $8, $9)
         on conflict (reuniao_id, pessoa_id) do update
            set status           = excluded.status,
                origem           = 'manual',
                horario_checkin  = excluded.horario_checkin,
                observacoes      = coalesce(excluded.observacoes, presenca.observacoes),
                registrado_por   = excluded.registrado_por
          returning id, status, origem, horario_checkin`,
        [reuniaoId, d.pessoaId, v.id, v.instituicao_id, v.cargo,
          d.status, horario, d.observacoes, u.id],
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    // Sem política de UPDATE o PostgreSQL não levanta erro: não enxerga a linha
    // e afeta zero registros, em silêncio.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Seu perfil não permite registrar presença.');
    }

    return {
      id: linha.id,
      pessoa: pessoa.nome,
      status: linha.status,
      origem: linha.origem,
      horarioCheckin: linha.horario_checkin,
    };
  });
}
