/**
 * Fila de aprovação da Diretoria no contrato /api/governanca:
 *
 *   GET  /solicitacoes
 *   POST /solicitacoes/:id/decisao
 *
 * Cada item leva o que a Diretoria precisa para decidir sem abrir outra tela:
 * `resumo` (nomes, não ids), `comparacao` (oficial × proposto) e `documentos`
 * com link temporário. A decisão é a de decidir-solicitacao.js — aplica a
 * operação do tipo, nunca um patch arbitrário.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { decidirSolicitacao } from '@/aplicacao/solicitacoes/decidir-solicitacao.js';
import { ROTULO_SOLICITACAO } from '@/aplicacao/solicitacoes/esquemas.js';
import { lerRegistroInstituicao, compararInstituicao } from './instituicao-registro.js';
import {
  isoComFuso, linkDocumento, presencaContrato, representacaoContrato, situacaoSolicitacaoContrato,
} from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */
/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */

const ROTULO_PRESENCA = { presente: 'Presente', ausente: 'Ausente', justificada: 'Ausência justificada' };

/**
 * @param {Usuario|null} usuario
 * @param {string} base  endereço da API, para os links
 * @param {{ status?: string }} [filtros]
 */
export async function filaDeSolicitacoes(usuario, base, filtros = {}) {
  const u = exigir(usuario, 'solicitacao', 'aprovar');

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select s.*, i.nome as instituicao_nome, autor.nome as autor_nome, analista.nome as analista_nome
         from solicitacao s
         join instituicao i on i.id = s.instituicao_id
         left join vw_usuario_publico autor    on autor.id = s.solicitado_por
         left join vw_usuario_publico analista on analista.id = s.analisado_por
        ${filtros.status === 'pendente' ? "where s.status = 'pendente'" : ''}
        order by (s.status = 'pendente') desc, s.created_at desc`);

    const fichas = new Map();
    const dados = [];
    for (const s of linhas) dados.push(await detalhar(tx, u, base, s, fichas));
    return { dados };
  });
}

/**
 * @param {Transacao} tx
 * @param {Usuario} u
 * @param {string} base
 * @param {any} s
 * @param {Map<string, any>} fichas  cache da ficha atual de cada instituição
 */
async function detalhar(tx, u, base, s, fichas) {
  const d = s.dados ?? {};
  /** @type {{ rotulo: string, valor: string }[]} */
  const resumo = [
    { rotulo: 'Instituição', valor: s.instituicao_nome },
    { rotulo: 'Pedido', valor: ROTULO_SOLICITACAO[s.tipo] ?? s.tipo },
  ];
  if (s.autor_nome) resumo.push({ rotulo: 'Solicitado por', valor: s.autor_nome });
  /** @type {{ rotulo: string, antes: unknown, depois: unknown }[]} */
  let comparacao = [];
  /** @type {Record<string, unknown>} */
  let alteracoes = d;
  const idsDocumentos = new Set([s.documento_id, d.oficioId, d.documentoId].filter(Boolean));

  switch (s.tipo) {
    case 'alteracao_cadastral': {
      alteracoes = d.alteracoes ?? {};
      // Pendente compara com o cadastro de AGORA (pode ter mudado desde o
      // pedido); decidida mostra o que estava gravado no pedido.
      if (s.status === 'pendente') {
        if (!fichas.has(s.instituicao_id)) fichas.set(s.instituicao_id, await lerRegistroInstituicao(tx, s.instituicao_id));
        comparacao = compararInstituicao(fichas.get(s.instituicao_id), alteracoes)
          .map(({ rotulo, antes, depois }) => ({ rotulo, antes, depois }));
      } else {
        comparacao = Object.entries(alteracoes).map(([k, v]) => ({ rotulo: k, antes: d.antes?.[k] ?? null, depois: v }));
      }
      break;
    }
    case 'correcao_presenca': {
      const r = await tx.consultaUm('select titulo, data from reuniao where id = $1', [d.reuniaoId]);
      const p = await tx.consultaUm('select nome from pessoa where id = $1', [d.pessoaId]);
      const atual = await tx.consultaUm(
        'select status, modo from presenca where reuniao_id = $1 and pessoa_id = $2', [d.reuniaoId, d.pessoaId]);
      if (r) resumo.push({ rotulo: 'Atividade', valor: `${r.titulo} (${r.data})` });
      if (p) resumo.push({ rotulo: 'Participante', valor: p.nome });
      // Decidida: o "antes" é o que estava gravado no pedido, não o valor já corrigido.
      const antes = s.status !== 'pendente' && d.antes?.statusPresenca
        ? d.antes.statusPresenca : presencaContrato(atual?.status ?? 'ausente');
      const depois = presencaContrato(d.status);
      alteracoes = { statusPresenca: depois, modalidade: d.modo ?? null };
      comparacao = [{ rotulo: 'Presença', antes: ROTULO_PRESENCA[antes] ?? antes, depois: ROTULO_PRESENCA[depois] ?? depois }];
      const modoAntes = s.status !== 'pendente' && d.antes ? d.antes.modalidade ?? null : atual?.modo ?? null;
      if (d.modo) comparacao.push({ rotulo: 'Modalidade', antes: modoAntes, depois: d.modo });
      break;
    }
    case 'substituicao_representante':
    case 'encerramento_representante': {
      const v = await tx.consultaUm(
        `select p.nome, v.tipo_representacao, v.data_inicio from vinculo v join pessoa p on p.id = v.pessoa_id
          where v.id = $1`, [d.representanteAnteriorId]);
      const anterior = v ? `${v.nome} (${representacaoContrato(v.tipo_representacao)}, desde ${v.data_inicio})`
        : d.representanteAnteriorNome ?? '—';
      resumo.push({ rotulo: 'Representante anterior', valor: anterior });
      if (s.tipo === 'substituicao_representante') {
        const n = d.novoRepresentante ?? {};
        const indicacao = [n.nome, n.tipo, n.cargo, n.email].filter(Boolean).join(' · ');
        resumo.push({ rotulo: 'Indicação proposta', valor: indicacao });
        alteracoes = { novoRepresentante: n };
        comparacao = [{ rotulo: n.tipo ? `Representante (${n.tipo})` : 'Representante', antes: v?.nome ?? null, depois: n.nome ?? null }];
      } else {
        alteracoes = { encerrar: d.representanteAnteriorId };
        comparacao = [{ rotulo: 'Vínculo', antes: 'Ativo', depois: 'Encerrado' }];
      }
      break;
    }
    case 'aprovacao_documento': {
      resumo.push({ rotulo: 'Tipo de documento', valor: d.tipoDocumento ?? 'documento' });
      break;
    }
    case 'alterar_dados': {
      alteracoes = d.campos ?? {};
      comparacao = Object.entries(alteracoes).map(([k, val]) => ({ rotulo: k, antes: null, depois: val }));
      break;
    }
    default:
      break;
  }

  const documentos = [];
  for (const id of idsDocumentos) {
    const doc = await tx.consultaUm('select id, nome, url_externa from documento where id = $1', [id]);
    if (!doc) continue;
    documentos.push({
      id: doc.id, nome: doc.nome,
      downloadUrl: doc.url_externa ?? linkDocumento(base, doc.id, u.id),
    });
  }

  return {
    id: s.id,
    instituicaoId: s.instituicao_id,
    instituicaoNome: s.instituicao_nome,
    tipo: s.tipo,
    rotulo: ROTULO_SOLICITACAO[s.tipo] ?? s.tipo,
    status: situacaoSolicitacaoContrato(s.status),
    justificativa: s.justificativa,
    alteracoes,
    versaoRegistro: Number(s.versao_registro),
    criadoEm: isoComFuso(s.created_at),
    solicitadoPor: s.autor_nome ?? null,
    analisadoPor: s.analista_nome ?? null,
    analisadoEm: isoComFuso(s.analisado_em),
    parecer: s.resposta ?? null,
    resumo,
    comparacao,
    documentos,
  };
}

const esquemaDecisao = z.object({
  decisao: z.enum(['aprovar', 'rejeitar', 'recusar'], {
    errorMap: () => ({ message: 'Decida "aprovar" ou "rejeitar".' }),
  }),
  parecer: z.string().trim().max(2000).optional().nullable(),
  versaoRegistro: z.coerce.number().int().positive().optional(),
});

/**
 * @param {Usuario|null} usuario
 * @param {string} id
 * @param {unknown} corpo
 */
export async function decidirPeloContrato(usuario, id, corpo) {
  const d = validar(esquemaDecisao, corpo ?? {});
  const r = await decidirSolicitacao(usuario, id, {
    decisao: d.decisao === 'aprovar' ? 'aprovar' : 'recusar',
    resposta: d.parecer ?? undefined,
    versaoRegistro: d.versaoRegistro,
  }).catch((e) => {
    // O contrato chama o campo de "parecer".
    if (e?.extra?.campos) e.extra.campos = e.extra.campos.map((c) => (c.campo === 'resposta' ? { ...c, campo: 'parecer' } : c));
    throw e;
  });
  return { solicitacao: { id: r.id, status: situacaoSolicitacaoContrato(r.status) } };
}
