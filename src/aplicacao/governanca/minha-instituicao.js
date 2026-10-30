/**
 * Área da instituição no contrato /api/governanca:
 *
 *   GET  /minha-instituicao
 *   POST /minha-instituicao/solicitacoes
 *   GET  /minha-instituicao/presencas
 *   GET  /minha-instituicao/representantes
 *
 * A instituição vem SEMPRE da sessão (contrato: "nunca de um ID fornecido pelo
 * cliente"). A gestão, que não é de uma instituição, pode olhar a de alguém
 * passando ?instituicaoId= — só para leitura.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { exigir, instituicaoDoRepresentante, validar } from '@/aplicacao/guarda.js';
import { registrarSolicitacao } from '@/aplicacao/solicitacoes/criar-solicitacao.js';
import {
  lerRegistroInstituicao, prepararRegistroInstituicao, compararInstituicao, CAMPOS_INSTITUICAO,
} from './instituicao-registro.js';
import {
  presencaContrato, presencaBanco, representacaoContrato, situacaoSolicitacaoContrato, isoComFuso, logoDaInstituicao,
} from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A instituição de quem chama. Representante: a da conta. Gestão: a indicada
 * na consulta (só leitura).
 *
 * @param {Usuario} u
 * @param {string|null|undefined} [pedida]
 */
export function instituicaoDaSessao(u, pedida) {
  if (ehGestao(u.papel)) {
    if (pedida && UUID.test(pedida)) return pedida;
    throw new ErroDeNegocio('CONTA_SEM_INSTITUICAO',
      'Sua conta não pertence a uma instituição. Abra a instituição pela lista de instituições.');
  }
  return instituicaoDoRepresentante(u);
}

// ------------------------------------------------------------------ resumo

/**
 * @param {Usuario|null} usuario
 * @param {string|null} [instituicaoPedida]
 */
export async function minhaInstituicao(usuario, instituicaoPedida, base = '') {
  const u = exigir(usuario, 'instituicao', 'ver');
  const id = instituicaoDaSessao(u, instituicaoPedida);

  return comUsuario(u.id, async (tx) => {
    const instituicao = { ...(await lerRegistroInstituicao(tx, id)), ...(await logoDaInstituicao(tx, id, { base, uid: u.id })) };
    const { versaoRegistro, ...ficha } = instituicao;

    // Regra oficial (a mesma do painel e dos relatórios): atividades que contam
    // no percentual, encerradas, em que a instituição tinha vínculo vigente.
    const resumo = await tx.consultaUm(
      `select reunioes_esperadas, reunioes_com_presenca, percentual_participacao
         from vw_participacao_instituicao where instituicao_id = $1`, [id]);
    const esperadas = Number(resumo?.reunioes_esperadas ?? 0);
    const comPresenca = Number(resumo?.reunioes_com_presenca ?? 0);

    const atividades = await tx.consulta(
      `select r.id, r.natureza, r.titulo, r.data, r.status, r.conta_participacao,
              bool_or(p.status = 'presente')    as presente,
              bool_or(p.status = 'justificado') as justificada,
              exists (select 1 from vw_reuniao_esperada e
                       where e.reuniao_id = r.id and e.instituicao_id = $1) as esperada
         from reuniao r
         left join presenca p on p.reuniao_id = r.id and p.instituicao_id = $1
        where r.status <> 'rascunho'
          and (p.id is not null
               or exists (select 1 from reuniao_convite c where c.reuniao_id = r.id and c.instituicao_id = $1)
               or exists (select 1 from vw_reuniao_esperada e where e.reuniao_id = r.id and e.instituicao_id = $1))
        group by r.id
        order by r.data desc
        limit 500`, [id]);

    const solicitacoes = await tx.consulta(
      `select id, tipo, status, created_at, resposta
         from solicitacao where instituicao_id = $1
        order by created_at desc`, [id]);

    return {
      instituicao: { ...ficha, versaoRegistro },
      participacao: {
        percentual: resumo?.percentual_participacao === null || resumo?.percentual_participacao === undefined
          ? null : Number(resumo.percentual_participacao),
        descricao: esperadas
          ? `${comPresenca} de ${esperadas} atividades elegíveis`
          : 'Nenhuma atividade elegível encerrada no período',
        numerador: comPresenca,
        denominador: esperadas,
        regra: 'Conta no máximo uma vez por atividade encerrada que entra no percentual oficial, '
          + 'entre as que ocorreram com a instituição representada (vínculo vigente na data). '
          + 'Convidados e equipe não contam.',
        atividades: atividades.map((a) => ({
          id: a.id,
          tipo: a.natureza,
          data: a.data,
          titulo: a.titulo,
          contaParticipacao: a.conta_participacao,
          status: a.presente ? 'presente'
            : a.justificada ? 'justificada'
              : a.status === 'encerrada' ? 'ausente'
                : a.status === 'cancelada' ? 'cancelada' : 'prevista',
        })),
      },
      solicitacoes: solicitacoes.map((s) => ({
        id: s.id,
        tipo: s.tipo,
        status: situacaoSolicitacaoContrato(s.status),
        criadoEm: isoComFuso(s.created_at),
        parecer: s.resposta ?? null,
      })),
    };
  });
}

// ------------------------------------------------------------ solicitações

const texto = (max) => z.string().trim().max(max);

const esquemaBase = z.object({
  tipo: z.enum(['alteracao_cadastral', 'correcao_presenca', 'substituicao_representante',
    'encerramento_representante'], { errorMap: () => ({ message: 'Tipo de solicitação inválido.' }) }),
  justificativa: texto(2000).optional().nullable().transform((v) => v || null),
}).passthrough();

const esquemaCadastral = z.object({
  alteracoes: z.record(z.unknown(), { invalid_type_error: 'Informe as alterações.' }),
});

const esquemaCorrecao = z.object({
  presencaId: z.string().trim().min(1, 'Indique a presença.'),
  alteracoes: z.object({
    statusPresenca: z.enum(['presente', 'ausente', 'justificada'], {
      errorMap: () => ({ message: 'Situação inválida: presente, ausente ou justificada.' }),
    }),
    modalidade: z.enum(['presencial', 'online']).optional().nullable().or(z.literal('')),
  }),
});

const esquemaRepresentacao = z.object({
  representanteAnteriorId: z.string().uuid('Indique o vínculo do representante.'),
  oficioId: z.string().uuid('Anexe o ofício e selecione-o.'),
  novoRepresentante: z.object({
    nome: texto(200).min(3, 'Informe o nome completo.'),
    email: z.string().trim().email('E-mail inválido.').optional().nullable().or(z.literal(''))
      .transform((v) => (v ? v.toLowerCase() : null)),
    telefone: texto(20).optional().nullable().transform((v) => v || null),
    cargo: texto(120).optional().nullable().transform((v) => v || null),
    tipo: z.enum(['titular', 'suplente', 'adicional', 'convidado'], {
      errorMap: () => ({ message: 'Tipo inválido: titular, suplente, adicional ou convidado.' }),
    }),
  }).optional(),
});

const campo = (c, m) => ({ campo: c, mensagem: m });

/**
 * @param {Usuario|null} usuario
 * @param {unknown} corpo
 */
export async function solicitarPelaInstituicao(usuario, corpo) {
  const u = exigir(usuario, 'solicitacao', 'criar');
  const base = validar(esquemaBase, corpo ?? {});
  const instituicaoId = instituicaoDaSessao(u, /** @type {any} */ (corpo)?.instituicaoId);

  return comUsuario(u.id, async (tx) => {
    /** @type {Record<string, any>} */ let dados;
    let documentoId = null;

    if (base.tipo === 'alteracao_cadastral') {
      const { alteracoes } = validar(esquemaCadastral, corpo);
      const desconhecidos = Object.keys(alteracoes).filter((k) => !CAMPOS_INSTITUICAO.includes(k));
      if (desconhecidos.length) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', `Campo que não existe na ficha: ${desconhecidos.join(', ')}.`,
          { campos: desconhecidos.map((k) => campo(k, 'Campo desconhecido.')) });
      }
      const atual = await lerRegistroInstituicao(tx, instituicaoId);
      const mudancas = compararInstituicao(atual, alteracoes);
      if (!mudancas.length) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhuma alteração em relação ao cadastro atual.');
      }
      const so = Object.fromEntries(mudancas.map((m) => [m.campo, m.depois]));
      // Valida já na entrada (sem gravar): a Diretoria não deve descobrir na
      // hora de aprovar que o pedido não tinha como ser aplicado.
      const { erros } = await prepararRegistroInstituicao(tx, instituicaoId, so, u, { conferirPermissao: false });
      if (erros.length) throw new ErroDeNegocio('DADOS_INVALIDOS', erros[0].mensagem, { campos: erros });
      dados = { alteracoes: so, antes: Object.fromEntries(mudancas.map((m) => [m.campo, m.antes])) };
    } else if (base.tipo === 'correcao_presenca') {
      const c = validar(esquemaCorrecao, corpo);
      if (!base.justificativa) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', 'Explique o motivo da correção.',
          { campos: [campo('justificativa', 'Informe o motivo.')] });
      }
      const alvo = await resolverPresenca(tx, instituicaoId, c.presencaId);
      dados = {
        reuniaoId: alvo.reuniaoId,
        pessoaId: alvo.pessoaId,
        presencaId: c.presencaId,
        status: presencaBanco(c.alteracoes.statusPresenca),
        modo: c.alteracoes.modalidade || null,
        observacoes: base.justificativa,
        antes: { statusPresenca: alvo.status, modalidade: alvo.modo },
      };
    } else {
      const r = validar(esquemaRepresentacao, corpo);
      if (!base.justificativa) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe o motivo.',
          { campos: [campo('justificativa', 'Informe o motivo.')] });
      }
      if (base.tipo === 'substituicao_representante' && !r.novoRepresentante) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe quem assume a representação.',
          { campos: [campo('novoRepresentante', 'Informe o novo representante.')] });
      }
      const vinculo = await tx.consultaUm(
        `select v.id, v.status, v.tipo_representacao, p.nome from vinculo v join pessoa p on p.id = v.pessoa_id
          where v.id = $1 and v.instituicao_id = $2`, [r.representanteAnteriorId, instituicaoId]);
      if (!vinculo) {
        throw new ErroDeNegocio('VINCULO_INVALIDO', 'Este representante não é da sua instituição.',
          { campos: [campo('representanteAnteriorId', 'Selecione um representante da instituição.')] });
      }
      if (vinculo.status !== 'ativo') {
        throw new ErroDeNegocio('VINCULO_JA_ENCERRADO', 'Este vínculo já está encerrado.');
      }
      const oficio = await tx.consultaUm(
        `select id from documento
          where id = $1 and instituicao_id = $2 and tipo = 'oficio' and status_analise <> 'recusado'`,
        [r.oficioId, instituicaoId]);
      if (!oficio) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', 'O ofício precisa ser um documento do tipo ofício da sua instituição.',
          { campos: [campo('oficioId', 'Selecione um ofício enviado pela instituição.')] });
      }
      documentoId = r.oficioId;
      dados = {
        representanteAnteriorId: r.representanteAnteriorId,
        representanteAnteriorNome: vinculo.nome,
        representanteAnteriorTipo: representacaoContrato(vinculo.tipo_representacao),
        oficioId: r.oficioId,
        ...(base.tipo === 'substituicao_representante' ? { novoRepresentante: r.novoRepresentante } : {}),
      };
    }

    const s = await registrarSolicitacao(tx, u, {
      instituicaoId, tipo: base.tipo, dados, justificativa: base.justificativa, documentoId,
    });
    return { solicitacao: { id: s.id, status: 'pendente', versaoRegistro: s.versaoRegistro } };
  });
}

/**
 * O id de participação do contrato: o id da presença, ou
 * "esperada:<reuniao>:<pessoa>" para a falta (não há linha de presença).
 *
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {string} instituicaoId
 * @param {string} presencaId
 */
async function resolverPresenca(tx, instituicaoId, presencaId) {
  const naoAchou = () => new ErroDeNegocio('NAO_ENCONTRADO',
    'Participação não encontrada entre as da sua instituição.',
    { campos: [campo('presencaId', 'Selecione uma participação da lista.')] });

  if (presencaId.startsWith('esperada:')) {
    const [, reuniaoId, pessoaId] = presencaId.split(':');
    if (!UUID.test(reuniaoId ?? '') || !UUID.test(pessoaId ?? '')) throw naoAchou();
    const e = await tx.consultaUm(
      `select 1 from vw_reuniao_esperada where reuniao_id = $1 and pessoa_id = $2 and instituicao_id = $3`,
      [reuniaoId, pessoaId, instituicaoId]);
    if (!e) throw naoAchou();
    return { reuniaoId, pessoaId, status: 'ausente', modo: null };
  }
  if (!UUID.test(presencaId)) throw naoAchou();
  const p = await tx.consultaUm(
    `select reuniao_id, pessoa_id, status, modo, tipo from presenca where id = $1 and instituicao_id = $2`,
    [presencaId, instituicaoId]);
  if (!p) throw naoAchou();
  if (!p.pessoa_id || p.tipo !== 'representante') {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Só a presença de representante da instituição pode ser corrigida.');
  }
  return { reuniaoId: p.reuniao_id, pessoaId: p.pessoa_id, status: presencaContrato(p.status), modo: p.modo };
}

// ---------------------------------------------------------------- presenças

/**
 * Presenças registradas e faltas esperadas dos representantes da instituição.
 *
 * @param {Usuario|null} usuario
 * @param {string|null} [instituicaoPedida]
 */
export async function presencasDaInstituicao(usuario, instituicaoPedida) {
  const u = exigir(usuario, 'presenca', 'ver');
  const id = instituicaoDaSessao(u, instituicaoPedida);

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select p.id::text as id, r.titulo, r.data, coalesce(pe.nome, p.nome_informado) as nome,
              p.status::text as status, p.modo, p.horario_checkin, p.tipo::text as tipo
         from presenca p
         join reuniao r on r.id = p.reuniao_id
         left join pessoa pe on pe.id = p.pessoa_id
        where p.instituicao_id = $1
       union all
       select 'esperada:' || e.reuniao_id || ':' || e.pessoa_id, r.titulo, r.data, pe.nome,
              'ausente', null, null, 'representante'
         from vw_reuniao_esperada e
         join reuniao r on r.id = e.reuniao_id
         join pessoa pe on pe.id = e.pessoa_id
        where e.instituicao_id = $1
          and not exists (select 1 from presenca p where p.reuniao_id = e.reuniao_id and p.pessoa_id = e.pessoa_id)
        order by 3 desc, 4`, [id]);

    return {
      dados: linhas.map((l) => ({
        id: l.id,
        atividadeTitulo: l.titulo,
        data: l.data,
        nome: l.nome,
        tipo: l.tipo,
        statusPresenca: presencaContrato(l.status),
        modalidade: l.modo,
        horarioCheckin: isoComFuso(l.horario_checkin),
      })),
    };
  });
}

// ----------------------------------------------------------- representantes

/**
 * @param {Usuario|null} usuario
 * @param {string|null} [instituicaoPedida]
 */
export async function representantesDaInstituicao(usuario, instituicaoPedida) {
  const u = exigir(usuario, 'vinculo', 'ver');
  const id = instituicaoDaSessao(u, instituicaoPedida);

  return comUsuario(u.id, async (tx) => {
    const vinculos = await tx.consulta(
      `select v.id, p.nome, v.tipo_representacao, v.data_inicio, v.data_fim, v.status, v.cargo
         from vinculo v join pessoa p on p.id = v.pessoa_id
        where v.instituicao_id = $1
        order by (v.status = 'ativo') desc, v.data_inicio desc`, [id]);
    const oficios = await tx.consulta(
      `select id, nome, status_analise from documento
        where instituicao_id = $1 and tipo = 'oficio' and status_analise <> 'recusado'
        order by created_at desc`, [id]);

    return {
      dados: vinculos.map((v) => ({
        vinculoId: v.id,
        nome: v.nome,
        tipo: representacaoContrato(v.tipo_representacao),
        cargo: v.cargo ?? null,
        inicio: v.data_inicio,
        fim: v.data_fim ?? null,
        status: v.status === 'ativo' ? 'ativo' : 'encerrado',
      })),
      oficios: oficios.map((o) => ({ id: o.id, nome: o.nome, status: o.status_analise })),
    };
  });
}
