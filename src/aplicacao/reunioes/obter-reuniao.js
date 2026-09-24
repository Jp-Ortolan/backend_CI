/**
 * CASO DE USO — Detalhe da reunião (RF25).
 *
 * Devolve a reunião, os números do resumo, a lista de participantes e o que a
 * tela precisa para desenhar o QR Code.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';
import { urlDoFront } from '@/infraestrutura/http/front.js';

/**
 * URL que o QR Code carrega: a tela pública de check-in, que vive no front.
 * Montada aqui porque o endereço é configuração de ambiente.
 *
 * @param {string} token
 */
function urlDeCheckin(token) {
  const base = urlDoFront();
  return `${base}/checkin/${token}`;
}

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 */
export async function obterReuniao(usuario, id) {
  const u = exigir(usuario, 'reuniao', 'ver');

  return comUsuario(u.id, async (tx) => {
    const r = await tx.consultaUm(
      `select r.*, autor.nome as criado_por_nome
         from reuniao r
         left join vw_usuario_publico autor on autor.id = r.created_by
        where r.id = $1`,
      [id],
    );
    if (!r) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');

    const resumo = await tx.consultaUm(
      'select * from vw_resumo_reuniao where reuniao_id = $1', [id],
    );

    const participantes = await tx.consulta(
      `select * from vw_reuniao_participante
        where reuniao_id = $1
        order by (status_presenca = 'presente') desc nulls last,
                 (status_confirmacao = 'confirmado') desc,
                 instituicao nulls last, nome`,
      [id],
    );

    const documentos = await tx.consulta(
      `select d.id, d.nome, d.descricao, d.tipo, d.mime_type, d.tamanho_bytes,
              d.storage_path, d.url_externa, d.created_at, autor.nome as enviado_por_nome
         from documento d
         left join vw_usuario_publico autor on autor.id = d.enviado_por
        where d.reuniao_id = $1
        order by d.created_at desc`,
      [id],
    );

    const encerrada = r.status === 'encerrada';

    return {
      id: r.id,
      titulo: r.titulo,
      descricao: r.descricao,
      pauta: r.pauta,
      data: r.data,
      horaInicio: r.hora_inicio,
      horaFim: r.hora_fim,
      local: r.local,
      endereco: r.endereco,
      status: r.status,

      checkin: {
// O token é o segredo do QR: quem o tem registra presença. Só sai daqui porque
// esta rota já exige sessão e permissão; nunca vai para resposta pública.
        token: r.qr_token,
        url: urlDeCheckin(r.qr_token),
        abreEm: r.checkin_abre_em,
        fechaEm: r.checkin_fecha_em,
        // Sem janela definida, vale o dia da reunião — mesma regra da função
        // checkin_aberto() no banco, repetida aqui só para a tela poder avisar.
        janelaPadrao: !r.checkin_abre_em && !r.checkin_fecha_em,
      },

      resumo: {
        esperados: Number(resumo?.esperados ?? 0),
        convitesEnviados: Number(resumo?.convites_enviados ?? 0),
        confirmados: Number(resumo?.confirmados ?? 0),
        presentes: Number(resumo?.presentes ?? 0),
        ausentes: Number(resumo?.ausentes ?? 0),
        convidados: Number(resumo?.convidados ?? 0),
        instituicoesPresentes: Number(resumo?.instituicoes_presentes ?? 0),
        percentualComparecimento: encerrada
          ? resumo?.percentual_comparecimento ?? null : null,
      },

      participantes: participantes.map((p) => ({
        conviteId: p.convite_id,
        presencaId: p.presenca_id,
        pessoaId: p.pessoa_id,
        instituicaoId: p.instituicao_id,
        nome: p.nome,
        instituicao: p.instituicao,
        cargo: p.cargo,
        tipo: p.tipo,
        statusConfirmacao: p.convite_id ? p.status_confirmacao : null,
        respondidoEm: p.respondido_em,
        statusPresenca: p.status_presenca,
        horarioCheckin: p.horario_checkin,
        origemPresenca: p.origem_presenca,
      })),

      documentos: documentos.map((d) => ({
        id: d.id,
        nome: d.nome,
        descricao: d.descricao,
        tipo: d.tipo,
        // storage_path é chave interna do armazenamento e não sai para a tela.
        origem: d.url_externa ? 'link' : 'arquivo',
        urlExterna: d.url_externa,
        mimeType: d.mime_type,
        tamanhoBytes: d.tamanho_bytes === null ? null : Number(d.tamanho_bytes),
        enviadoEm: d.created_at,
        enviadoPor: d.enviado_por_nome,
      })),

      cadastro: {
        criadoEm: r.created_at,
        criadoPor: r.criado_por_nome,
        atualizadoEm: r.updated_at,
      },
    };
  });
}
