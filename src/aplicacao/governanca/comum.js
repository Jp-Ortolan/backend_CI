/**
 * Peças comuns da camada /api/governanca: nomes do contrato do front ↔ nomes
 * do banco, e links assinados.
 *
 * O contrato do front (docs/prompt-backend.md e docs/contratos-complementares.md
 * no repositório do front) usa alguns nomes diferentes dos nossos. A regra de
 * negócio é uma só — a dos casos de uso em src/aplicacao —, e aqui fica só a
 * tradução.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { paraUsuarioSessao } from '@/infraestrutura/seguranca/sessao.js';
import { assinar } from '@/infraestrutura/seguranca/assinatura.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

/** Papel do banco → papel canônico do contrato. */
export const PAPEL_CONTRATO = {
  admin: 'admin_geral', diretoria: 'diretoria', representante: 'representante_instituicao',
};
/** E de volta (aceita também os nomes legados). */
export const PAPEL_BANCO = {
  admin_geral: 'admin', admin: 'admin', administrador: 'admin',
  diretoria: 'diretoria', gestor: 'diretoria',
  representante_instituicao: 'representante', representante: 'representante',
};

/** Tipo de representação do banco ↔ contrato ("integrante" é "adicional" na tela). */
export const representacaoContrato = (t) => (t === 'integrante' ? 'adicional' : t);
export const representacaoBanco = (t) => (t === 'adicional' ? 'integrante' : t);

/** Presença: o banco diz "justificado", a tela "justificada". */
export const presencaContrato = (s) => (s === 'justificado' ? 'justificada' : s);
export const presencaBanco = (s) => (s === 'justificada' ? 'justificado' : s);

/** Situação da reunião/evento: "agendada" no banco é "publicada" na tela. */
export const situacaoAtividadeContrato = (s) => (s === 'agendada' ? 'publicada' : s);
export const situacaoAtividadeBanco = (s) => (s === 'publicada' ? 'agendada' : s);

/** Situação da solicitação: recusar = "solicitar ajustes" na tela. */
export const situacaoSolicitacaoContrato = (s) => (s === 'recusada' ? 'ajustes_solicitados' : s);

/**
 * A conta, lida pelo id (para o download por link assinado, que não tem cookie).
 *
 * @param {string} id
 */
export async function usuarioPorId(id) {
  const l = await comUsuario(id, (tx) => tx.consultaUm(
    'select id, nome, email, papel, ativo, instituicao_id, pessoa_id from usuario where id = $1', [id]));
  if (!l || !l.ativo) throw new ErroDeNegocio('NAO_AUTENTICADO', 'Este link não vale mais. Abra o documento de novo pelo sistema.');
  return paraUsuarioSessao(l);
}

/**
 * Link absoluto e temporário para baixar um documento guardado no sistema.
 *
 * @param {string} base  baseDaApi(req)
 * @param {string} documentoId
 * @param {string} usuarioId  quem pode baixar (o RLS é conferido de novo no download)
 */
export const linkDocumento = (base, documentoId, usuarioId) =>
  `${base}/api/governanca/arquivos/${assinar({ t: 'doc', id: documentoId, u: usuarioId })}`;

/** "2026-11-01T09:00" sem fuso → instante em America/Sao_Paulo (UTC-3, sem horário de verão desde 2019). */
export function horarioLocalParaIso(v) {
  if (!v) return null;
  const t = String(v).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) return new Date(t).toISOString();
  const d = new Date(`${t.length === 16 ? `${t}:00` : t}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Instante → "2026-11-01T09:00:00-03:00", o formato que o contrato devolve. */
export function isoComFuso(v) {
  if (!v) return null;
  const d = new Date(new Date(v).getTime() - 3 * 3600_000);
  return `${d.toISOString().slice(0, 19)}-03:00`;
}

/**
 * Logo da instituição para a ficha: o link (temporário) da logo vigente e se
 * há uma logo nova esperando a Diretoria. Sem permissão de ver o arquivo
 * (logo interna de outra instituição), o link vem null.
 *
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {string} id
 * @param {{ base: string, uid: string }} ctx
 */
export async function logoDaInstituicao(tx, id, ctx) {
  const atual = await tx.consultaUm(
    `select d.id from instituicao i join documento d on d.id = i.logo_documento_id where i.id = $1`, [id]);
  const pendente = await tx.consultaUm(
    `select id from documento where instituicao_id = $1 and tipo = 'logo' and status_analise = 'em_analise'
      order by created_at desc limit 1`, [id]);
  return {
    logoUrl: atual && ctx.base ? linkDocumento(ctx.base, atual.id, ctx.uid) : null,
    logoEmAnalise: !!pendente,
  };
}
