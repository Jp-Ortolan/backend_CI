/**
 * Histórico de auditoria e observações internas (contrato /api/governanca):
 *
 *   GET  /auditoria?inicio&fim&recurso&autor&cursor&limite
 *   GET  /instituicoes/:id/observacoes
 *   POST /instituicoes/:id/observacoes
 *
 * Só a gestão. O log é gravado pelas triggers (o servidor é a fonte de autor e
 * horário); aqui ele só é lido, e nunca sai segredo em antes/depois.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { validar } from '@/aplicacao/guarda.js';
import { isoComFuso } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */

/** @param {Usuario|null} usuario */
function gestao(usuario) {
  if (!usuario || !usuario.ativo) throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
  if (!ehGestao(usuario.papel)) {
    throw new ErroDeNegocio('SEM_PERMISSAO', 'Só a administração e a Diretoria consultam o histórico.');
  }
  return usuario;
}

/** Recurso do contrato → tabela auditada (e filtro extra). */
const RECURSOS = {
  instituicoes: { entidades: ['instituicao', 'instituicao_observacao'] },
  representantes: { entidades: ['pessoa', 'vinculo'] },
  reunioes: { entidades: ['reuniao'], natureza: 'reuniao' },
  eventos: { entidades: ['reuniao'], natureza: 'evento' },
  presencas: { entidades: ['presenca'] },
  documentos: { entidades: ['documento'] },
  contas: { entidades: ['usuario'] },
  solicitacoes: { entidades: ['solicitacao'] },
  importacoes: { entidades: ['importacao'] },
  encaminhamentos: { entidades: ['encaminhamento'] },
  convocacoes: { entidades: ['convocacao'] },
};
const RECURSO_DA_ENTIDADE = {
  instituicao: 'instituicoes', instituicao_observacao: 'instituicoes', pessoa: 'representantes',
  vinculo: 'representantes', presenca: 'presencas', documento: 'documentos', usuario: 'contas',
  solicitacao: 'solicitacoes', importacao: 'importacoes', encaminhamento: 'encaminhamentos',
  convocacao: 'convocacoes',
};
const ACAO = { insercao: 'criacao', atualizacao: 'alteracao', exclusao: 'exclusao' };

/** Campos que nunca saem no histórico. */
const SEGREDO = /senha|hash|token|segredo|conteudo|checksum|storage_path|assinatura_ip|cpf/i;
/** @param {unknown} v */
function limpar(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v ?? null;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !SEGREDO.test(k)));
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const esquemaFiltro = z.object({
  inicio: z.string().regex(DATA, 'Data inicial inválida.').optional().or(z.literal('')),
  fim: z.string().regex(DATA, 'Data final inválida.').optional().or(z.literal('')),
  recurso: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(RECURSOS)), {
    errorMap: () => ({ message: 'Recurso inválido.' }),
  }).optional().or(z.literal('')),
  autor: z.string().trim().max(120).optional(),
  cursor: z.string().trim().max(40).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});

/** @param {Usuario|null} usuario @param {unknown} filtros */
export async function consultarAuditoria(usuario, filtros) {
  const u = gestao(usuario);
  const f = validar(esquemaFiltro, filtros ?? {});

  /** @type {string[]} */ const cond = [];
  /** @type {unknown[]} */ const val = [];
  const add = (sql, v) => { val.push(v); cond.push(sql.replace('?', `$${val.length}`)); };

  // Dias inteiros no fuso do Fórum, inclusivos.
  if (f.inicio) add(`l.created_at >= (?::date::timestamp at time zone 'America/Sao_Paulo')`, f.inicio);
  if (f.fim) add(`l.created_at < ((?::date + 1)::timestamp at time zone 'America/Sao_Paulo')`, f.fim);
  if (f.recurso) {
    const r = RECURSOS[f.recurso];
    add('l.entidade = any(?::text[])', r.entidades);
    if (r.natureza) {
      add(`exists (select 1 from reuniao rr where rr.id::text = l.registro_id and rr.natureza = ?::natureza_atividade)`, r.natureza);
    }
  }
  if (f.autor) add(`imutavel_unaccent(lower(a.nome)) like '%' || imutavel_unaccent(lower(?)) || '%'`, f.autor);
  if (f.cursor) {
    const id = Number(Buffer.from(f.cursor, 'base64url').toString('utf8'));
    if (!Number.isInteger(id) || id <= 0) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Cursor inválido.');
    add('l.id < ?', id);
  }
  val.push(f.limite + 1);

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select l.id, l.entidade, l.registro_id, l.acao, l.alteracoes, l.created_at, a.nome as autor_nome,
              case l.entidade
                when 'instituicao' then (select coalesce(nome_fantasia, nome) from instituicao where id::text = l.registro_id)
                when 'pessoa'      then (select nome from pessoa where id::text = l.registro_id)
                when 'vinculo'     then (select p.nome || ' — ' || i.nome from vinculo v join pessoa p on p.id = v.pessoa_id
                                          join instituicao i on i.id = v.instituicao_id where v.id::text = l.registro_id)
                when 'reuniao'     then (select titulo from reuniao where id::text = l.registro_id)
                when 'documento'   then (select nome from documento where id::text = l.registro_id)
                when 'usuario'     then (select nome from usuario where id::text = l.registro_id)
                when 'solicitacao' then (select s.tipo::text || ' — ' || i.nome from solicitacao s
                                          join instituicao i on i.id = s.instituicao_id where s.id::text = l.registro_id)
                when 'presenca'    then (select coalesce(p.nome, pr.nome_informado) || ' — ' || r.titulo from presenca pr
                                          join reuniao r on r.id = pr.reuniao_id left join pessoa p on p.id = pr.pessoa_id
                                          where pr.id::text = l.registro_id)
              end as recurso_nome,
              (select natureza::text from reuniao where l.entidade = 'reuniao' and id::text = l.registro_id) as natureza
         from log_auditoria l
         left join usuario a on a.id = l.usuario_id
        ${cond.length ? `where ${cond.join(' and ')}` : ''}
        order by l.id desc
        limit $${val.length}`, val);

    const pagina = linhas.slice(0, f.limite);
    const temMais = linhas.length > f.limite;

    return {
      dados: pagina.map((l) => {
        const alt = l.alteracoes ?? {};
        let antes = null;
        let depois = null;
        if (l.acao === 'atualizacao') {
          antes = {}; depois = {};
          for (const [k, v] of Object.entries(alt)) {
            if (SEGREDO.test(k)) continue;
            antes[k] = v?.antes ?? null; depois[k] = v?.depois ?? null;
          }
        } else {
          antes = limpar(alt.antes); depois = limpar(alt.depois);
        }
        return {
          id: String(l.id),
          criadoEm: isoComFuso(l.created_at),
          autorNome: l.autor_nome ?? 'Sistema',
          acao: ACAO[l.acao] ?? l.acao,
          recurso: l.entidade === 'reuniao' ? (l.natureza === 'evento' ? 'eventos' : 'reunioes')
            : RECURSO_DA_ENTIDADE[l.entidade] ?? l.entidade,
          recursoId: l.registro_id,
          recursoNome: l.recurso_nome ?? null,
          justificativa: depois?.justificativa ?? depois?.motivo_encerramento ?? depois?.resposta ?? null,
          antes,
          depois,
        };
      }),
      proximoCursor: temMais ? Buffer.from(String(pagina[pagina.length - 1].id)).toString('base64url') : null,
    };
  });
}

// ------------------------------------------------------------- observações

/** @param {Usuario|null} usuario @param {string} instituicaoId */
export async function listarObservacoes(usuario, instituicaoId) {
  const u = gestao(usuario);
  return comUsuario(u.id, async (tx) => {
    const i = await tx.consultaUm('select id from instituicao where id = $1', [instituicaoId]);
    if (!i) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');
    const linhas = await tx.consulta(
      `select o.id, o.texto, o.created_at, a.nome as autor_nome
         from instituicao_observacao o left join usuario a on a.id = o.autor_id
        where o.instituicao_id = $1 order by o.created_at desc`, [instituicaoId]);
    return {
      dados: linhas.map((o) => ({
        id: o.id, texto: o.texto, autorNome: o.autor_nome ?? null, criadoEm: isoComFuso(o.created_at),
      })),
    };
  });
}

const esquemaObservacao = z.object({
  texto: z.string().trim().min(1, 'Escreva a observação.').max(5000, 'Máximo de 5000 caracteres.'),
});

/** @param {Usuario|null} usuario @param {string} instituicaoId @param {unknown} corpo */
export async function adicionarObservacao(usuario, instituicaoId, corpo) {
  const u = gestao(usuario);
  const { texto } = validar(esquemaObservacao, corpo ?? {});
  return comUsuario(u.id, async (tx) => {
    const i = await tx.consultaUm('select id from instituicao where id = $1', [instituicaoId]);
    if (!i) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');
    const o = await tx.consultaUm(
      `insert into instituicao_observacao (instituicao_id, texto, autor_id) values ($1, $2, $3)
       returning id, created_at`, [instituicaoId, texto, u.id]);
    return { observacao: { id: o.id, texto, autorNome: u.nome, criadoEm: isoComFuso(o.created_at) } };
  });
}
