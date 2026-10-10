/**
 * CASO DE USO — Credenciamento: abrir, fechar e gerar QR novo (revisão de outubro).
 *
 * A janela do check-in já existia (checkin_abre_em / checkin_fecha_em), mas
 * só se definia no cadastro. Na prática a Diretoria quer apertar um botão
 * quando a reunião começa e outro quando o credenciamento acaba.
 *
 *   abrir     — vale a partir de agora, sem hora para fechar; a reunião
 *               agendada passa a "em andamento".
 *   fechar    — ninguém mais registra presença pelo QR. Correção continua
 *               possível pela marcação manual.
 *   novo_qr   — troca o token: o QR antigo (fotografado, mandado no grupo)
 *               para de funcionar na hora.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { urlDoFront } from '@/infraestrutura/http/front.js';

export const esquemaCredenciamento = z.object({
  acao: z.enum(['abrir', 'fechar', 'novo_qr'], {
    errorMap: () => ({ message: 'Ação inválida: abrir, fechar ou novo_qr.' }),
  }),
  // Aproveita o mesmo botão para decidir se convidado avulso pode entrar.
  permiteConvidado: z.boolean().optional(),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} reuniaoId
 * @param {unknown} entrada
 */
export async function credenciamento(usuario, reuniaoId, entrada) {
  const u = exigir(usuario, 'presenca', 'editar');
  if (u.papel === 'representante') {
    throw new ErroDeNegocio('SEM_PERMISSAO', 'O credenciamento é conduzido pela Diretoria.');
  }
  const { acao, permiteConvidado } = validar(esquemaCredenciamento, entrada ?? {});

  return comUsuario(u.id, async (tx) => {
    const r = await tx.consultaUm(
      'select id, status, checkin_abre_em from reuniao where id = $1', [reuniaoId]);
    if (!r) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');
    if (['cancelada', 'encerrada', 'rascunho'].includes(r.status) && acao === 'abrir') {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        r.status === 'rascunho'
          ? 'Publique a atividade antes de abrir o credenciamento.'
          : `A atividade está "${r.status}": não há credenciamento para abrir.`);
    }

    let sql;
    if (acao === 'abrir') {
      sql = `update reuniao
                set checkin_abre_em = now(), checkin_fecha_em = null,
                    status = case when status = 'agendada' then 'em_andamento' else status end`;
    } else if (acao === 'fechar') {
      // A constraint exige fecha > abre. Se a abertura estava marcada para
      // depois (ou nem existia), ela vira "um segundo antes de fechar".
      sql = `update reuniao
                set checkin_fecha_em = now(),
                    checkin_abre_em = least(coalesce(checkin_abre_em, now() - interval '1 second'),
                                            now() - interval '1 second')`;
    } else {
      sql = `update reuniao set qr_token = encode(gen_random_bytes(16), 'hex')`;
    }
    if (permiteConvidado !== undefined) sql += `, permite_convidado = ${permiteConvidado ? 'true' : 'false'}`;

    const linha = await tx.consultaUm(
      `${sql} where id = $1
       returning id, status, qr_token, checkin_abre_em, checkin_fecha_em,
                 permite_convidado, checkin_aberto(reuniao.*) as aberto`,
      [reuniaoId],
    );
    if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite conduzir o credenciamento.');

    return {
      id: linha.id,
      status: linha.status,
      // Dentro desta transação now() é o instante do fechamento, e a função
      // ainda diria "aberto" — para quem chama, fechar é fechado.
      aberto: acao === 'fechar' ? false : linha.aberto,
      abreEm: linha.checkin_abre_em,
      fechaEm: linha.checkin_fecha_em,
      permiteConvidado: linha.permite_convidado,
      token: linha.qr_token,
      url: `${urlDoFront()}/checkin/${linha.qr_token}`,
    };
  });
}
