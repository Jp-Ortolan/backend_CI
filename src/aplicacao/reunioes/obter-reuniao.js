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
import { ehGestao } from '@/dominio/permissoes.js';

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
 * @param {'reuniao'|'evento'} [natureza]
 */
export async function obterReuniao(usuario, id, natureza) {
  const u = exigir(usuario, natureza ?? 'reuniao', 'ver');
  const gestao = ehGestao(u.papel);

  return comUsuario(u.id, async (tx) => {
    const r = await tx.consultaUm(
      `select r.*, autor.nome as criado_por_nome, t.nome as tipo_nome,
              g.nome as grupo_trabalho_nome,
              checkin_aberto(r.*) as checkin_aberto_agora
         from reuniao r
         left join vw_usuario_publico autor on autor.id = r.created_by
         left join tipo_atividade t on t.id = r.tipo_atividade_id
         left join grupo_trabalho g on g.id = r.grupo_trabalho_id
        where r.id = $1`,
      [id],
    );
    if (!r || (natureza && r.natureza !== natureza)) {
      throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA',
        natureza === 'evento' ? 'Evento não encontrado.' : 'Reunião não encontrada.');
    }

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
              d.storage_path, d.url_externa, d.created_at, d.visibilidade, d.versao,
              autor.nome as enviado_por_nome
         from documento d
         left join vw_usuario_publico autor on autor.id = d.enviado_por
        where d.reuniao_id = $1
        order by d.created_at desc`,
      [id],
    );

    const encaminhamentos = await tx.consulta(
      `select e.id, e.descricao, e.responsavel, e.responsavel_instituicao_id,
              i.nome as responsavel_instituicao, e.prazo, e.status, e.concluido_em,
              e.observacoes
         from encaminhamento e
         left join instituicao i on i.id = e.responsavel_instituicao_id
        where e.reuniao_id = $1
        order by e.prazo nulls last, e.created_at`,
      [id],
    );

    const encerrada = r.status === 'encerrada';

    return {
      id: r.id,
      titulo: r.titulo,
      natureza: r.natureza,
      tipoAtividadeId: r.tipo_atividade_id,
      tipo: r.tipo_nome,
      numero: r.numero,
      modalidade: r.modalidade,
      responsavel: r.responsavel,
      publicoAlvo: r.publico_alvo,
      limiteParticipantes: r.limite_participantes,
      contaParticipacao: r.conta_participacao,
      permiteConvidado: r.permite_convidado,
      exibirPublico: r.exibir_publico,
      grupoTrabalho: r.grupo_trabalho_id
        ? { id: Number(r.grupo_trabalho_id), nome: r.grupo_trabalho_nome } : null,
      organizacaoResponsavel: r.organizacao_responsavel,
      eventoProprio: r.evento_proprio,
      inscricaoUrl: r.inscricao_url,
      totalParticipantesExterno: r.total_participantes_externo,
      descricao: r.descricao,
      pauta: r.pauta,
      data: r.data,
      horaInicio: r.hora_inicio,
      horaFim: r.hora_fim,
      local: r.local,
      endereco: r.endereco,
      link: r.link,
      senhaAcesso: r.senha_acesso,
      status: r.status,

      checkin: {
// O token é o segredo do QR: quem o tem registra presença. Só a gestão o
// recebe — é ela que projeta o QR na sala. O representante registra a própria
// presença lendo o QR na hora, e não pode repassar o link para quem não veio.
        token: gestao ? r.qr_token : null,
        url: gestao ? urlDeCheckin(r.qr_token) : null,
        aberto: r.checkin_aberto_agora,
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
        justificados: Number(resumo?.justificados ?? 0),
        convidados: Number(resumo?.convidados ?? 0),
        equipe: Number(resumo?.equipe ?? 0),
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
        modo: p.modo,
        assinadoEm: p.assinado_em,
        observacoes: p.observacoes_presenca,
        registradoPor: p.registrado_por,
        tipoRepresentacao: p.tipo_representacao,
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
        visibilidade: d.visibilidade,
        versao: Number(d.versao),
        enviadoEm: d.created_at,
        enviadoPor: d.enviado_por_nome,
      })),

      encaminhamentos: encaminhamentos.map((e) => ({
        id: e.id,
        descricao: e.descricao,
        responsavel: e.responsavel,
        responsavelInstituicao: e.responsavel_instituicao_id
          ? { id: e.responsavel_instituicao_id, nome: e.responsavel_instituicao } : null,
        prazo: e.prazo,
        status: e.status,
        concluidoEm: e.concluido_em,
        observacoes: e.observacoes,
      })),

      cadastro: {
        criadoEm: r.created_at,
        criadoPor: r.criado_por_nome,
        atualizadoEm: r.updated_at,
      },
    };
  });
}
