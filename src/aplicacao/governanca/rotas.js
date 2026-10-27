/**
 * As rotas do contrato /api/governanca, em ordem. Cada uma: ler a requisição,
 * chamar o caso de uso, devolver o envelope do contrato.
 */
import { registrar } from '@/infraestrutura/http/rotas-governanca.js';
import { okV1, confirmadoV1 } from '@/infraestrutura/http/governanca.js';
import { respostaDeArquivo } from '@/infraestrutura/http/arquivo.js';
import { verificar } from '@/infraestrutura/seguranca/assinatura.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { baixarDocumento } from '@/aplicacao/documentos/baixar-documento.js';
import { painelGovernanca } from './publico.js';
import {
  obterGovernancaInstituicao, salvarGovernancaInstituicao,
  obterGovernancaRepresentante, salvarGovernancaRepresentante,
} from './cadastros.js';
import {
  minhaInstituicao, solicitarPelaInstituicao, presencasDaInstituicao, representantesDaInstituicao,
} from './minha-instituicao.js';
import { filaDeSolicitacoes, decidirPeloContrato } from './solicitacoes.js';
import {
  resolverEscopo, listarDocumentosDoEscopo, enviarDocumentoDoEscopo, LIMITE_DOCUMENTO_BYTES,
} from './documentos.js';
import { listarContas, criarConta, editarConta } from './contas.js';
import { listarNotificacoes, marcarLida, salvarPreferencias } from './notificacoes.js';
import { consultarAuditoria, listarObservacoes, adicionarObservacao } from './auditoria.js';
import { usuarioPorId } from './comum.js';

// ------------------------------------------------------------------- público
registrar('GET', 'publico', async (c) => okV1(await painelGovernanca(c.base)));

// ------------------------------------------------- download por link assinado
registrar('GET', 'arquivos/:token', async (c) => {
  const t = verificar(c.p.token);
  if (!t || t.t !== 'doc' || !t.u) {
    throw new ErroDeNegocio('NAO_AUTENTICADO', 'Este link venceu. Abra o documento de novo pelo sistema.');
  }
  const doc = await baixarDocumento(await usuarioPorId(t.u), t.id);
  return respostaDeArquivo({ ...doc, inline: doc.mimeType === 'application/pdf' || doc.mimeType.startsWith('image/') });
});

// -------------------------------------------------- fichas de governança
registrar('GET', 'instituicoes/:id/governanca', async (c) =>
  okV1({ registro: await obterGovernancaInstituicao(await c.usuario(), c.p.id) }));
registrar('PATCH', 'instituicoes/:id/governanca', async (c) =>
  confirmadoV1({ registro: await salvarGovernancaInstituicao(await c.usuario(), c.p.id, await c.json()) }));
registrar('GET', 'representantes/:id/governanca', async (c) =>
  okV1({ registro: await obterGovernancaRepresentante(await c.usuario(), c.p.id) }));
registrar('PATCH', 'representantes/:id/governanca', async (c) =>
  confirmadoV1({ registro: await salvarGovernancaRepresentante(await c.usuario(), c.p.id, await c.json()) }));

// ------------------------------------------------------ área da instituição
registrar('GET', 'minha-instituicao', async (c) =>
  okV1(await minhaInstituicao(await c.usuario(), c.consulta.get('instituicaoId'))));
registrar('POST', 'minha-instituicao/solicitacoes', async (c) =>
  confirmadoV1(await solicitarPelaInstituicao(await c.usuario(), await c.json()), 201));
registrar('GET', 'minha-instituicao/presencas', async (c) =>
  okV1(await presencasDaInstituicao(await c.usuario(), c.consulta.get('instituicaoId'))));
registrar('GET', 'minha-instituicao/representantes', async (c) =>
  okV1(await representantesDaInstituicao(await c.usuario(), c.consulta.get('instituicaoId'))));

// ------------------------------------------------------------- solicitações
registrar('GET', 'solicitacoes', async (c) =>
  okV1(await filaDeSolicitacoes(await c.usuario(), c.base, { status: c.consulta.get('status') ?? undefined })));
registrar('POST', 'solicitacoes/:id/decisao', async (c) =>
  confirmadoV1(await decidirPeloContrato(await c.usuario(), c.p.id, await c.json())));

// --------------------------------------------------------------- documentos
const escopoDocs = (c, tipo) => (u) => resolverEscopo(u, tipo, c.p.id);
for (const [padrao, tipo] of [
  ['minha-instituicao/documentos', 'minha-instituicao'],
  ['instituicoes/:id/documentos', 'instituicoes'],
  ['reunioes/:id/documentos', 'reunioes'],
  ['eventos/:id/documentos', 'eventos'],
]) {
  registrar('GET', padrao, async (c) =>
    okV1(await listarDocumentosDoEscopo(await c.usuario(), escopoDocs(c, tipo), c.base)));
  registrar('POST', padrao, async (c) => {
    const { campos, arquivo } = await c.multipart(LIMITE_DOCUMENTO_BYTES);
    return confirmadoV1(await enviarDocumentoDoEscopo(await c.usuario(), escopoDocs(c, tipo), campos, arquivo), 201);
  });
}

// ------------------------------------------------------------------- contas
registrar('GET', 'contas', async (c) => okV1(await listarContas(await c.usuario())));
registrar('POST', 'contas', async (c) => confirmadoV1(await criarConta(await c.usuario(), await c.json()), 201));
registrar('PATCH', 'contas/:id', async (c) =>
  confirmadoV1(await editarConta(await c.usuario(), c.p.id, await c.json())));

// ------------------------------------------------------------- notificações
registrar('GET', 'notificacoes', async (c) => okV1(await listarNotificacoes(await c.usuario())));
registrar('PATCH', 'notificacoes/preferencias', async (c) =>
  confirmadoV1(await salvarPreferencias(await c.usuario(), await c.json())));
registrar('POST', 'notificacoes/:id/lida', async (c) =>
  confirmadoV1(await marcarLida(await c.usuario(), c.p.id)));

// ------------------------------------------------- auditoria e observações
registrar('GET', 'auditoria', async (c) =>
  okV1(await consultarAuditoria(await c.usuario(), Object.fromEntries(c.consulta))));
registrar('GET', 'instituicoes/:id/observacoes', async (c) =>
  okV1(await listarObservacoes(await c.usuario(), c.p.id)));
registrar('POST', 'instituicoes/:id/observacoes', async (c) =>
  confirmadoV1(await adicionarObservacao(await c.usuario(), c.p.id, await c.json()), 201));
