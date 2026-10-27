/**
 * Credenciamento, QR e presença manual no contrato /api/governanca:
 *
 *   GET  /{escopo}/credenciamento
 *   POST /{escopo}/credenciamento/abrir     { inicio, fim, permiteConvidados }
 *   POST /{escopo}/credenciamento/encerrar  {}
 *   POST /{escopo}/presencas                inclusão/correção manual (idempotente)
 *   GET  /qr/:token                         a imagem PNG do QR
 *
 * escopo = reunioes/:id | eventos/:id.
 *
 * O QR leva a URL de check-in do front com o qr_token (aleatório, 128 bits),
 * nunca o id da atividade. Abrir o credenciamento gera um token novo — o QR
 * anterior (impresso, mandado no grupo) para de valer.
 */
import { z } from 'zod';
import QRCode from 'qrcode';
import { comUsuario, consultaUm } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { urlDoFront } from '@/infraestrutura/http/front.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { aplicarMarcacao } from '@/aplicacao/presencas/marcar-presenca.js';
import { umaVez } from './idempotencia.js';
import { horarioLocalParaIso, isoComFuso, presencaContrato, presencaBanco } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */
/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */
/** @typedef {'reuniao'|'evento'} Natureza */

/**
 * @param {Transacao} tx
 * @param {string} id
 * @param {Natureza} natureza
 */
async function atividade(tx, id, natureza) {
  const r = await tx.consultaUm(
    `select r.*, checkin_aberto(r.*) as aberto from reuniao r where r.id = $1`, [id]);
  if (!r || r.natureza !== natureza) {
    throw new ErroDeNegocio('NAO_ENCONTRADO', natureza === 'evento' ? 'Evento não encontrado.' : 'Reunião não encontrada.');
  }
  return r;
}

const urlCheckin = (token) => `${urlDoFront()}/checkin/${token}`;

/**
 * Percentual da atividade: instituições presentes (no máximo uma vez cada)
 * sobre as esperadas — vínculo vigente na data, se conta no percentual
 * oficial; convidadas/convocadas, se não conta. Sem esperadas, null.
 *
 * @param {Transacao} tx
 * @param {any} r
 */
async function percentual(tx, r) {
  const l = await tx.consultaUm(
    `with esperadas as (
       select distinct v.instituicao_id from vinculo v
        where $2 and v.data_inicio <= $3 and (v.data_fim is null or v.data_fim >= $3)
       union
       select distinct c.instituicao_id from reuniao_convite c where not $2 and c.reuniao_id = $1
       union
       select distinct c.instituicao_id from convocacao c where not $2 and c.reuniao_id = $1
     )
     select (select count(*) from esperadas) as esperadas,
            (select count(distinct p.instituicao_id) from presenca p
              where p.reuniao_id = $1 and p.status = 'presente' and p.tipo = 'representante'
                and p.instituicao_id in (select instituicao_id from esperadas)) as presentes`,
    [r.id, r.conta_participacao, r.data]);
  const esperadas = Number(l?.esperadas ?? 0);
  return esperadas ? Math.round((1000 * Number(l.presentes)) / esperadas) / 10 : null;
}

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {Natureza} natureza
 * @param {string} base
 */
export async function obterCredenciamento(usuario, id, natureza, base) {
  const u = exigir(usuario, 'presenca', 'ver');
  const gestao = ehGestao(u.papel);

  return comUsuario(u.id, async (tx) => {
    const r = await atividade(tx, id, natureza);
    const participantes = await tx.consulta(
      `select p.id, coalesce(pe.nome, p.nome_informado) as nome,
              coalesce(i.nome, p.instituicao_informada) as instituicao,
              p.tipo, p.status, p.modo, p.horario_checkin, p.origem, p.instituicao_id
         from presenca p
         left join pessoa pe on pe.id = p.pessoa_id
         left join instituicao i on i.id = p.instituicao_id
        where p.reuniao_id = $1 ${gestao ? '' : 'and p.instituicao_id = $2'}
        order by p.horario_checkin desc nulls last, 2`,
      gestao ? [id] : [id, u.instituicaoId]);

    const status = r.aberto ? 'aberto'
      : r.checkin_fecha_em && new Date(r.checkin_fecha_em) <= new Date() ? 'encerrado'
        : ['encerrada', 'cancelada'].includes(r.status) ? 'encerrado' : 'fechado';

    const resposta = {
      status,
      inicio: isoComFuso(r.checkin_abre_em),
      fim: isoComFuso(r.checkin_fecha_em),
      permiteConvidados: !!r.permite_convidado,
      checkinUrl: r.status === 'rascunho' ? null : urlCheckin(r.qr_token),
      qrCodeUrl: gestao && r.status !== 'rascunho' ? `${base}/api/governanca/qr/${r.qr_token}` : null,
      percentual: await percentual(tx, r),
      participantes: participantes.map((p) => ({
        id: p.id,
        nome: p.nome,
        instituicao: p.instituicao ?? null,
        tipo: p.tipo,
        statusPresenca: presencaContrato(p.status),
        modalidade: p.modo,
        origem: p.origem,
        horarioCheckin: isoComFuso(p.horario_checkin),
      })),
      // A fila offline do front só aparece com isto: a idempotência por
      // chaveOperacao está implementada no POST /presencas.
      registroOfflineHabilitado: gestao,
    };

    if (!gestao) return { ...resposta, pessoas: [], instituicoes: [] };

    // Seletores da inclusão manual: quem pode estar ali e as instituições.
    const pessoas = await tx.consulta(
      `select distinct p.id, p.nome from pessoa p
         join vinculo v on v.pessoa_id = p.id
        where v.data_inicio <= $1 and (v.data_fim is null or v.data_fim >= $1)
       union
       select p.id, coalesce(pe.nome, p.nome_informado) from presenca p
         join pessoa pe on pe.id = p.pessoa_id where p.reuniao_id = $2
       order by 2`, [r.data, id]);
    const instituicoes = await tx.consulta(
      `select id, coalesce(nome_fantasia, nome) as nome from instituicao
        where status not in ('desligada', 'rascunho') order by 2`);
    return { ...resposta, pessoas, instituicoes };
  });
}

const esquemaAbrir = z.object({
  inicio: z.string().trim().min(10, 'Informe a abertura.'),
  fim: z.string().trim().min(10, 'Informe o encerramento.'),
  permiteConvidados: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional()
    .transform((v) => v === true || v === 'true'),
});

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {Natureza} natureza
 * @param {unknown} corpo
 */
export async function abrirCredenciamento(usuario, id, natureza, corpo) {
  const u = exigir(usuario, 'presenca', 'editar');
  if (!ehGestao(u.papel)) throw new ErroDeNegocio('SEM_PERMISSAO', 'O credenciamento é conduzido pela Diretoria.');
  const d = validar(esquemaAbrir, corpo ?? {});
  const inicio = horarioLocalParaIso(d.inicio);
  const fim = horarioLocalParaIso(d.fim);
  if (!inicio) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Abertura inválida.', { campos: [{ campo: 'inicio', mensagem: 'Data e hora inválidas.' }] });
  if (!fim) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Encerramento inválido.', { campos: [{ campo: 'fim', mensagem: 'Data e hora inválidas.' }] });
  if (fim <= inicio) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'O encerramento precisa ser depois da abertura.',
      { campos: [{ campo: 'fim', mensagem: 'Posterior à abertura.' }] });
  }
  if (new Date(fim) <= new Date()) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'O encerramento já passou. Informe um período atual ou futuro.',
      { campos: [{ campo: 'fim', mensagem: 'Já passou.' }] });
  }

  return comUsuario(u.id, async (tx) => {
    const r = await atividade(tx, id, natureza);
    if (['rascunho', 'cancelada', 'encerrada'].includes(r.status)) {
      throw new ErroDeNegocio('TRANSICAO_INVALIDA', r.status === 'rascunho'
        ? 'Publique a atividade antes de abrir o credenciamento.'
        : 'Esta atividade não está mais aberta a presenças.');
    }
    const l = await tx.consultaUm(
      `update reuniao
          set checkin_abre_em = $2, checkin_fecha_em = $3, permite_convidado = $4,
              qr_token = encode(gen_random_bytes(16), 'hex'),
              status = case when status = 'agendada' and $2::timestamptz <= now() then 'em_andamento' else status end
        where id = $1 returning id`, [id, inicio, fim, d.permiteConvidados]);
    if (!l) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não conduz o credenciamento.');
    return {};
  });
}

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {Natureza} natureza
 */
export async function encerrarCredenciamento(usuario, id, natureza) {
  const u = exigir(usuario, 'presenca', 'editar');
  if (!ehGestao(u.papel)) throw new ErroDeNegocio('SEM_PERMISSAO', 'O credenciamento é conduzido pela Diretoria.');
  return comUsuario(u.id, async (tx) => {
    await atividade(tx, id, natureza);
    const l = await tx.consultaUm(
      `update reuniao
          set checkin_fecha_em = now(),
              checkin_abre_em = least(coalesce(checkin_abre_em, now() - interval '1 second'), now() - interval '1 second')
        where id = $1 returning id`, [id]);
    if (!l) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não conduz o credenciamento.');
    return {};
  });
}

// --------------------------------------------------------- presença manual

const esquemaManual = z.object({
  pessoaId: z.string().uuid('Selecione o participante.'),
  instituicaoId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => v || null),
  tipo: z.enum(['representante', 'convidado', 'equipe'], { errorMap: () => ({ message: 'Tipo inválido.' }) }),
  statusPresenca: z.enum(['presente', 'ausente', 'justificada'], { errorMap: () => ({ message: 'Situação inválida.' }) }),
  modalidade: z.enum(['presencial', 'online']).optional().nullable(),
  justificativa: z.string().trim().min(3, 'Informe a justificativa da inclusão ou correção.').max(500),
  chaveOperacao: z.string().optional().nullable(),
  registradoOfflineEm: z.string().optional().nullable(),
});

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {Natureza} natureza
 * @param {unknown} corpo
 */
export async function registrarPresencaManual(usuario, id, natureza, corpo) {
  if (usuario?.papel === 'representante') {
    throw new ErroDeNegocio('ALTERACAO_EXIGE_APROVACAO',
      'A correção de presença é pedida à Diretoria pela área da instituição.');
  }
  const u = exigir(usuario, 'presenca', 'editar');
  const d = validar(esquemaManual, corpo ?? {});
  const { chaveOperacao, registradoOfflineEm, ...conteudo } = d;
  const offline = registradoOfflineEm && !Number.isNaN(new Date(registradoOfflineEm).getTime())
    ? new Date(registradoOfflineEm).toISOString() : null;

  return comUsuario(u.id, async (tx) => {
    await atividade(tx, id, natureza);
    return umaVez(tx, u, chaveOperacao, `presenca:${id}`, conteudo, async () => {
      let presencaId;
      try {
        if (d.tipo === 'representante') {
          const r = await aplicarMarcacao(tx, u.id, id, {
            pessoaId: d.pessoaId, status: presencaBanco(d.statusPresenca),
            observacoes: d.justificativa, modo: d.modalidade ?? null,
          });
          presencaId = r.id;
          if (d.instituicaoId) {
            const p = await tx.consultaUm('select instituicao_id from presenca where id = $1', [r.id]);
            if (p?.instituicao_id !== d.instituicaoId) {
              throw new ErroDeNegocio('VINCULO_INVALIDO',
                'Na data da atividade esta pessoa representava outra instituição. Confira a instituição selecionada.');
            }
          }
        } else {
          // Convidado e equipe: entram na lista, nunca no percentual das
          // instituições (sem vínculo e sem instituicao_id).
          const pessoa = await tx.consultaUm('select id, nome, email from pessoa where id = $1', [d.pessoaId]);
          if (!pessoa) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Participante não encontrado.');
          const inst = d.instituicaoId
            ? await tx.consultaUm('select coalesce(nome_fantasia, nome) as nome from instituicao where id = $1', [d.instituicaoId])
            : null;
          if (d.instituicaoId && !inst) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');
          const status = presencaBanco(d.statusPresenca);
          const l = await tx.consultaUm(
            `insert into presenca (reuniao_id, pessoa_id, tipo, status, origem, horario_checkin,
                                   nome_informado, email_informado, instituicao_informada,
                                   observacoes, registrado_por, modo)
             values ($1, $2, $3::tipo_participante, $4::status_presenca, 'manual',
                     case when $4 = 'presente' then now() end, $5, $6, $7, $8, $9,
                     case when $4 = 'presente' then coalesce($10, 'presencial') end)
             on conflict (reuniao_id, pessoa_id) do update
                set tipo = excluded.tipo, vinculo_id = null, instituicao_id = null,
                    status = excluded.status, origem = 'manual',
                    horario_checkin = case when excluded.status = 'presente'
                                           then coalesce(presenca.horario_checkin, now()) end,
                    nome_informado = excluded.nome_informado, instituicao_informada = excluded.instituicao_informada,
                    observacoes = excluded.observacoes, registrado_por = excluded.registrado_por,
                    modo = excluded.modo
             returning id`,
            [id, d.pessoaId, d.tipo, status, pessoa.nome, pessoa.email, inst?.nome ?? null,
              d.justificativa, u.id, d.modalidade ?? null]);
          if (!l) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não registra presença.');
          presencaId = l.id;
        }
        if (offline) {
          await tx.consulta('update presenca set registrado_offline_em = $2 where id = $1', [presencaId, offline]);
        }
      } catch (e) {
        if (e instanceof ErroDeNegocio) throw e;
        traduzirErroDoBanco(e);
      }
      return { presenca: { id: presencaId } };
    });
  });
}

// ---------------------------------------------------------------------- QR

/**
 * PNG do QR da atividade. O token é o próprio conteúdo do QR (está na tela de
 * quem conduz o credenciamento); a rota não revela nada além da imagem.
 *
 * @param {string} token
 */
export async function imagemQr(token) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new ErroDeNegocio('NAO_ENCONTRADO', 'QR Code não encontrado.');
  const ok = await consultaUm('select checkin_token_valido($1) as ok', [token]);
  if (!ok?.ok) throw new ErroDeNegocio('NAO_ENCONTRADO', 'QR Code não encontrado ou substituído.');
  return QRCode.toBuffer(urlCheckin(token), { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' });
}
