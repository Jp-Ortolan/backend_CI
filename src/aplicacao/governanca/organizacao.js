/**
 * Organização da atividade no contrato /api/governanca:
 *
 *   GET   /{escopo}/organizacao
 *   POST  /{escopo}/convocacoes                (idempotente por chaveOperacao)
 *   POST  /{escopo}/encaminhamentos
 *   PATCH /{escopo}/encaminhamentos/:eid
 *   GET   /minha-instituicao/convocacoes
 *   POST  /minha-instituicao/convocacoes/:id/resposta
 *
 * Convocação: registrada primeiro (é o que `confirmado: true` significa), e-mail
 * depois do commit, com a entrega gravada de verdade (enviada ou falhou — nunca
 * "entregue" sem confirmação do provedor). RSVP não é presença.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { entregar, enviar } from '@/infraestrutura/email/enviar.js';
import { urlDoFront } from '@/infraestrutura/http/front.js';
import { log } from '@/infraestrutura/observabilidade/log.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { umaVez } from './idempotencia.js';
import { instituicaoDaSessao } from './minha-instituicao.js';
import { horarioLocalParaIso, isoComFuso } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */
/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */
/** @typedef {'reuniao'|'evento'} Natureza */

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** @param {Transacao} tx @param {string} id @param {Natureza} natureza */
async function atividade(tx, id, natureza) {
  const r = await tx.consultaUm('select id, titulo, data, local, status, natureza from reuniao where id = $1', [id]);
  if (!r || r.natureza !== natureza) {
    throw new ErroDeNegocio('NAO_ENCONTRADO', natureza === 'evento' ? 'Evento não encontrado.' : 'Reunião não encontrada.');
  }
  return r;
}

/** @param {any} e */
const encaminhamento = (e) => ({
  id: e.id,
  titulo: e.titulo ?? e.descricao,
  descricao: e.descricao ?? '',
  responsavelId: e.responsavel_pessoa_id ?? '',
  responsavelNome: e.responsavel_nome ?? e.responsavel ?? '',
  prazo: e.prazo ?? '',
  status: e.status,
  resultado: e.resultado ?? '',
  versaoRegistro: Number(e.versao_registro),
});

/** @param {any} c */
const convocacao = (c) => ({
  id: c.id,
  instituicaoId: c.instituicao_id,
  instituicaoNome: c.instituicao_nome,
  assunto: c.assunto,
  enviadaEm: isoComFuso(c.enviada_em),
  prazoResposta: isoComFuso(c.prazo_resposta),
  statusEntrega: c.status_entrega,
  detalheEntrega: c.entrega_detalhe ?? null,
  resposta: c.resposta ?? null,
  representanteNome: c.representante_nome ?? null,
  justificativa: c.justificativa ?? null,
  respondidaEm: isoComFuso(c.respondida_em),
});

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {Natureza} natureza
 */
export async function obterOrganizacao(usuario, id, natureza) {
  const u = exigir(usuario, natureza, 'ver');
  const gestao = ehGestao(u.papel);

  return comUsuario(u.id, async (tx) => {
    const r = await atividade(tx, id, natureza);
    const convocacoes = await tx.consulta(
      `select c.*, coalesce(i.nome_fantasia, i.nome) as instituicao_nome, p.nome as representante_nome
         from convocacao c
         join instituicao i on i.id = c.instituicao_id
         left join pessoa p on p.id = c.representante_pessoa_id
        where c.reuniao_id = $1 order by 2`, [id]);
    const encaminhamentos = await tx.consulta(
      `select e.*, p.nome as responsavel_nome from encaminhamento e
         left join pessoa p on p.id = e.responsavel_pessoa_id
        where e.reuniao_id = $1 order by e.prazo nulls last, e.created_at`, [id]);

    const instituicoes = gestao ? await tx.consulta(
      `select id, coalesce(nome_fantasia, nome) as nome from instituicao
        where status in ('ativa', 'em_processo_saida') order by 2`) : [];
    const responsaveis = gestao ? await tx.consulta(
      `select distinct p.id, p.nome from pessoa p join vinculo v on v.pessoa_id = p.id
        where v.status = 'ativo' order by 2`) : [];

    return {
      atividade: { id: r.id, titulo: r.titulo, data: r.data, status: r.status },
      instituicoes,
      responsaveis,
      convocacoes: convocacoes.map(convocacao),
      encaminhamentos: encaminhamentos.map(encaminhamento),
    };
  });
}

// --------------------------------------------------------------- convocação

const esquemaConvocacao = z.object({
  assunto: z.string().trim().min(3, 'Informe o assunto.').max(200),
  mensagem: z.string().trim().min(3, 'Escreva a mensagem.').max(5000),
  prazoResposta: z.string().trim().optional().nullable().transform((v) => v || null),
  instituicoes: z.array(z.string().uuid('Instituição inválida.'), { required_error: 'Selecione as instituições.' })
    .min(1, 'Selecione ao menos uma instituição.').max(500),
  chaveOperacao: z.string().optional().nullable(),
});

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {Natureza} natureza
 * @param {unknown} corpo
 */
export async function convocar(usuario, id, natureza, corpo) {
  const u = exigir(usuario, natureza, 'editar');
  if (!ehGestao(u.papel)) throw new ErroDeNegocio('SEM_PERMISSAO', 'Só a Diretoria convoca.');
  const d = validar(esquemaConvocacao, corpo ?? {});
  const prazo = d.prazoResposta ? horarioLocalParaIso(d.prazoResposta) : null;
  if (d.prazoResposta && !prazo) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Prazo inválido.', { campos: [{ campo: 'prazoResposta', mensagem: 'Data e hora inválidas.' }] });
  }
  if (prazo && new Date(prazo) <= new Date()) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'O prazo de resposta já passou.', { campos: [{ campo: 'prazoResposta', mensagem: 'Informe um prazo futuro.' }] });
  }
  const instituicoes = [...new Set(d.instituicoes)].sort();

  const r = await comUsuario(u.id, async (tx) => {
    const a = await atividade(tx, id, natureza);
    return umaVez(tx, u, d.chaveOperacao, `convocacao:${id}`,
      { assunto: d.assunto, mensagem: d.mensagem, prazo, instituicoes }, async () => {
        if (['rascunho', 'cancelada', 'encerrada'].includes(a.status)) {
          throw new ErroDeNegocio('TRANSICAO_INVALIDA', a.status === 'rascunho'
            ? 'Publique a atividade antes de convocar.' : 'Esta atividade não recebe mais convocações.');
        }
        const existentes = await tx.consulta(
          `select id from instituicao where id = any($1::uuid[]) and status not in ('desligada', 'rascunho')`, [instituicoes]);
        if (existentes.length !== instituicoes.length) {
          throw new ErroDeNegocio('DADOS_INVALIDOS', 'Há instituição selecionada que não pode ser convocada.',
            { campos: [{ campo: 'instituicoes', mensagem: 'Revise a seleção.' }] });
        }
        const ids = [];
        try {
          for (const instituicaoId of instituicoes) {
            const l = await tx.consultaUm(
              `insert into convocacao (reuniao_id, instituicao_id, assunto, mensagem, prazo_resposta, enviada_por)
               values ($1, $2, $3, $4, $5, $6)
               on conflict (reuniao_id, instituicao_id) do update
                  set assunto = excluded.assunto, mensagem = excluded.mensagem,
                      prazo_resposta = excluded.prazo_resposta, enviada_em = now(),
                      enviada_por = excluded.enviada_por, status_entrega = 'pendente', entrega_detalhe = null
               returning id`, [id, instituicaoId, d.assunto, d.mensagem, prazo, u.id]);
            ids.push(l.id);
          }
        } catch (e) {
          traduzirErroDoBanco(e);
        }
        return { convocacoes: ids, atividade: { titulo: a.titulo, data: a.data, local: a.local } };
      });
  });

  // Repetição da mesma chave: já foi registrada (e enviada) da primeira vez.
  if (!r.repetida) await enviarConvocacoes(u, r.convocacoes, r.atividade, d, prazo);
  return { convocacoes: r.convocacoes.map((cid) => ({ id: cid })) };
}

/**
 * E-mails depois do commit, um por destinatário; a entrega fica gravada.
 *
 * @param {Usuario} u
 * @param {string[]} ids
 * @param {{ titulo: string, data: string, local: string|null }} a
 * @param {{ assunto: string, mensagem: string }} d
 * @param {string|null} prazo
 */
async function enviarConvocacoes(u, ids, a, d, prazo) {
  for (const cid of ids) {
    try {
      const { instituicaoId } = await comUsuario(u.id, async (tx) => ({
        instituicaoId: (await tx.consultaUm('select instituicao_id from convocacao where id = $1', [cid])).instituicao_id,
      }));
      const contatos = await comUsuario(u.id, async (tx) => {
        const c = await tx.consulta('select * from contatos_para_aviso($1, null, $2)', [instituicaoId, 'emailConvocacoes']);
        // O sino avisa sempre; o e-mail respeita a preferência de cada conta.
        for (const x of c.filter((y) => y.usuario_id)) {
          await tx.consulta(
            `insert into notificacao (usuario_id, titulo, mensagem, link) values ($1, $2, $3, '/minha-instituicao')`,
            [x.usuario_id, `Convocação: ${a.titulo}`.slice(0, 200), d.assunto]);
        }
        return c;
      });
      const emails = [...new Set(contatos.filter((c) => c.quer_email && c.email).map((c) => c.email.toLowerCase()))];

      let status = 'falhou';
      let detalhe = 'Nenhum e-mail autorizado para esta instituição.';
      if (emails.length) {
        const resultados = [];
        for (const para of emails) {
          resultados.push(await entregar({
            para,
            assunto: d.assunto,
            texto: [
              d.mensagem, '',
              `Atividade: ${a.titulo} — ${a.data}${a.local ? ` · ${a.local}` : ''}`,
              prazo ? `Responda até ${isoComFuso(prazo)?.replace('T', ' ').slice(0, 16)}.` : '',
              `Para confirmar, acesse ${urlDoFront()}/minha-instituicao`,
            ].filter((l) => l !== null).join('\n'),
          }));
        }
        const ok = resultados.filter((x) => x.status === 'enviada').length;
        status = ok ? 'enviada' : 'falhou';
        detalhe = ok === resultados.length ? null
          : ok ? `${ok} de ${resultados.length} e-mails aceitos pelo provedor.`
            : resultados[0].detalhe;
      }
      await comUsuario(u.id, (tx) => tx.consulta(
        `update convocacao set status_entrega = $2::status_entrega, entrega_detalhe = $3, destinatarios = $4 where id = $1`,
        [cid, status, detalhe, emails.length]));
    } catch (e) {
      // A convocação está registrada; a falha fica visível como "falhou".
      log.erro('convocacao_envio', e);
      await comUsuario(u.id, (tx) => tx.consulta(
        `update convocacao set status_entrega = 'falhou', entrega_detalhe = 'Erro ao preparar o envio.' where id = $1`,
        [cid])).catch(() => {});
    }
  }
}

// ------------------------------------------------------------ encaminhamento

const esquemaEncaminhamento = z.object({
  titulo: z.string().trim().min(3, 'Informe o título.').max(200),
  descricao: z.string().trim().max(5000).optional().nullable().transform((v) => v || null),
  responsavelId: z.string({ required_error: 'Selecione o responsável.' }).uuid('Selecione o responsável.'),
  prazo: z.string({ required_error: 'Informe o prazo.' }).regex(DATA, 'Informe o prazo.'),
  status: z.enum(['pendente', 'em_andamento', 'concluido', 'cancelado'], { errorMap: () => ({ message: 'Situação inválida.' }) })
    .optional().default('pendente'),
  resultado: z.string().trim().max(5000).optional().nullable().transform((v) => v || null),
  versaoRegistro: z.coerce.number().int().positive().optional(),
}).refine((d) => !['concluido', 'cancelado'].includes(d.status) || !!d.resultado, {
  message: 'Informe o resultado (ou o motivo do cancelamento).', path: ['resultado'],
});

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {Natureza} natureza
 * @param {string|null} eid  null = criar
 * @param {unknown} corpo
 */
export async function salvarEncaminhamento(usuario, id, natureza, eid, corpo) {
  const u = exigir(usuario, natureza, 'editar');
  if (!ehGestao(u.papel)) throw new ErroDeNegocio('SEM_PERMISSAO', 'Só a Diretoria registra encaminhamentos.');
  const d = validar(esquemaEncaminhamento, corpo ?? {});

  const r = await comUsuario(u.id, async (tx) => {
    await atividade(tx, id, natureza);
    const pessoa = await tx.consultaUm('select id, nome from pessoa where id = $1', [d.responsavelId]);
    if (!pessoa) {
      throw new ErroDeNegocio('NAO_ENCONTRADO', 'Responsável não encontrado.',
        { campos: [{ campo: 'responsavelId', mensagem: 'Selecione da lista.' }] });
    }
    let atual = null;
    if (eid) {
      atual = await tx.consultaUm('select * from encaminhamento where id = $1 and reuniao_id = $2', [eid, id]);
      if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Encaminhamento não encontrado.');
      if (d.versaoRegistro && Number(d.versaoRegistro) !== Number(atual.versao_registro)) {
        throw new ErroDeNegocio('VERSAO_DESATUALIZADA',
          'Este encaminhamento foi alterado por outra pessoa. Atualize e refaça.', { versaoAtual: Number(atual.versao_registro) });
      }
      if (['concluido', 'cancelado'].includes(atual.status) && d.status !== atual.status) {
        throw new ErroDeNegocio('TRANSICAO_INVALIDA',
          `Encaminhamento ${atual.status === 'concluido' ? 'concluído' : 'cancelado'} não muda de situação. Registre um novo.`);
      }
    }

    let linha;
    try {
      const valores = [d.titulo, d.descricao ?? d.titulo, pessoa.id, pessoa.nome, d.prazo, d.status, d.resultado];
      linha = eid
        ? await tx.consultaUm(
          `update encaminhamento
              set titulo = $2, descricao = $3, responsavel_pessoa_id = $4, responsavel = $5, prazo = $6,
                  status = $7::status_encaminhamento, resultado = $8,
                  concluido_em = case when $7 = 'concluido' then coalesce(concluido_em, current_date) end
            where id = $1 returning *`, [eid, ...valores])
        : await tx.consultaUm(
          `insert into encaminhamento (reuniao_id, titulo, descricao, responsavel_pessoa_id, responsavel, prazo,
                                       status, resultado, concluido_em, created_by)
           values ($1, $2, $3, $4, $5, $6, $7::status_encaminhamento, $8,
                   case when $7 = 'concluido' then current_date end, $9)
           returning *`, [id, ...valores, u.id]);
    } catch (e) {
      traduzirErroDoBanco(e);
    }
    if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não registra encaminhamentos.');

    // Avisa o responsável (novo ou trocado) no sino; e-mail se ele aceitar.
    let avisar = [];
    if (!atual || atual.responsavel_pessoa_id !== pessoa.id) {
      avisar = await tx.consulta('select * from contatos_para_aviso(null, $1, $2)', [pessoa.id, 'emailEncaminhamentos']);
      for (const c of avisar) {
        await tx.consulta(
          `insert into notificacao (usuario_id, titulo, mensagem, link) values ($1, $2, $3, null)`,
          [c.usuario_id, `Encaminhamento para você: ${d.titulo}`.slice(0, 200), `Prazo: ${d.prazo}`]);
      }
    }
    return { linha: { ...linha, responsavel_nome: pessoa.nome }, avisar };
  });

  for (const c of r.avisar.filter((x) => x.quer_email && x.email)) {
    await enviar({
      para: c.email,
      assunto: `Encaminhamento: ${d.titulo}`,
      texto: [`Você foi indicado(a) como responsável por "${d.titulo}".`, `Prazo: ${d.prazo}`, d.descricao ?? ''].join('\n'),
    });
  }
  return { encaminhamento: encaminhamento(r.linha) };
}

// ------------------------------------------------- RSVP da própria instituição

/** @param {Usuario|null} usuario @param {string|null} [pedida] */
export async function convocacoesDaInstituicao(usuario, pedida) {
  const u = exigir(usuario, 'instituicao', 'ver');
  const instituicaoId = instituicaoDaSessao(u, pedida);
  const podeResponderConta = u.papel === 'representante';

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select c.*, r.titulo, r.data, r.local, r.status as status_atividade, p.nome as representante_nome
         from convocacao c
         join reuniao r on r.id = c.reuniao_id
         left join pessoa p on p.id = c.representante_pessoa_id
        where c.instituicao_id = $1
        order by r.data desc`, [instituicaoId]);
    const representantes = await tx.consulta(
      `select distinct p.id, p.nome from vinculo v join pessoa p on p.id = v.pessoa_id
        where v.instituicao_id = $1 and v.status = 'ativo' order by 2`, [instituicaoId]);
    const agora = Date.now();
    return {
      dados: linhas.map((c) => ({
        id: c.id,
        titulo: c.titulo,
        assunto: c.assunto,
        data: c.data,
        local: c.local ?? '',
        mensagem: c.mensagem,
        prazoResposta: isoComFuso(c.prazo_resposta),
        resposta: c.resposta ?? null,
        representanteId: c.representante_pessoa_id ?? null,
        representanteNome: c.representante_nome ?? null,
        justificativa: c.justificativa ?? null,
        podeResponder: podeResponderConta
          && ['agendada', 'em_andamento'].includes(c.status_atividade)
          && (!c.prazo_resposta || new Date(c.prazo_resposta).getTime() > agora),
        versaoRegistro: Number(c.versao_registro),
      })),
      representantes,
    };
  });
}

const esquemaResposta = z.object({
  resposta: z.enum(['confirmada', 'recusada'], { errorMap: () => ({ message: 'Confirme ou informe a ausência.' }) }),
  representanteId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => v || null),
  justificativa: z.string().trim().max(2000).optional().nullable().transform((v) => v || null),
  versaoRegistro: z.coerce.number().int().positive().optional(),
});

/** @param {Usuario|null} usuario @param {string} id @param {unknown} corpo */
export async function responderConvocacao(usuario, id, corpo) {
  const u = exigir(usuario, 'instituicao', 'ver');
  if (u.papel !== 'representante') {
    throw new ErroDeNegocio('SEM_PERMISSAO', 'A resposta à convocação é dada pela conta da instituição.');
  }
  const instituicaoId = instituicaoDaSessao(u, null);
  const d = validar(esquemaResposta, corpo ?? {});
  if (d.resposta === 'confirmada' && !d.representanteId) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Indique quem vai representar a instituição.',
      { campos: [{ campo: 'representanteId', mensagem: 'Selecione o representante.' }] });
  }
  if (d.resposta === 'recusada' && !d.justificativa) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe o motivo da ausência.',
      { campos: [{ campo: 'justificativa', mensagem: 'Informe o motivo.' }] });
  }

  return comUsuario(u.id, async (tx) => {
    const c = await tx.consultaUm(
      `select c.*, r.status as status_atividade, r.titulo from convocacao c join reuniao r on r.id = c.reuniao_id
        where c.id = $1 and c.instituicao_id = $2 for update of c`, [id, instituicaoId]);
    if (!c) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Convocação não encontrada.');
    if (d.versaoRegistro && Number(d.versaoRegistro) !== Number(c.versao_registro)) {
      throw new ErroDeNegocio('VERSAO_DESATUALIZADA', 'Esta convocação mudou desde que você abriu a tela. Atualize.',
        { versaoAtual: Number(c.versao_registro) });
    }
    if (!['agendada', 'em_andamento'].includes(c.status_atividade)) {
      throw new ErroDeNegocio('TRANSICAO_INVALIDA', 'A atividade não recebe mais respostas.');
    }
    if (c.prazo_resposta && new Date(c.prazo_resposta) <= new Date()) {
      throw new ErroDeNegocio('TRANSICAO_INVALIDA', 'O prazo para responder terminou.');
    }
    if (d.representanteId) {
      const v = await tx.consultaUm(
        `select 1 from vinculo where pessoa_id = $1 and instituicao_id = $2 and status = 'ativo'`,
        [d.representanteId, instituicaoId]);
      if (!v) {
        throw new ErroDeNegocio('VINCULO_INVALIDO', 'Esta pessoa não é representante ativa da instituição.',
          { campos: [{ campo: 'representanteId', mensagem: 'Selecione um representante ativo.' }] });
      }
    }
    try {
      await tx.consulta(
        `update convocacao set resposta = $2::resposta_convocacao, representante_pessoa_id = $3,
                justificativa = $4, respondida_em = now(), respondida_por = $5
          where id = $1`,
        [id, d.resposta, d.resposta === 'confirmada' ? d.representanteId : d.representanteId, d.justificativa, u.id]);
    } catch (e) {
      traduzirErroDoBanco(e);
    }
    await tx.consulta('select notificar_gestao($1, $2, $3)', [
      `Convocação ${d.resposta === 'confirmada' ? 'confirmada' : 'recusada'}: ${c.titulo}`,
      d.justificativa ?? '', '/reunioes']);
    return {};
  });
}
