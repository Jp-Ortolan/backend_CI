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
import {
  listarEventos, configuracaoEventos, obterEvento, salvarEvento,
  obterGovernancaReuniao, salvarGovernancaReuniao,
} from './atividades.js';
import {
  obterCredenciamento, abrirCredenciamento, encerrarCredenciamento, registrarPresencaManual, imagemQr,
} from './credenciamento.js';
import {
  obterOrganizacao, convocar, salvarEncaminhamento, convocacoesDaInstituicao, responderConvocacao,
} from './organizacao.js';
import { abrirCheckin, confirmarCheckin } from './checkin.js';
import { gerarRelatorio, baixarRelatorio } from './relatorios.js';
import {
  listarImportacoes, validarImportacao, confirmarImportacao, LIMITE_IMPORTACAO_BYTES,
} from './importacoes.js';
import { exigirDentroDoLimite, ipDaRequisicao } from '@/infraestrutura/http/limite.js';

// ------------------------------------------------------------------- público
registrar('GET', 'publico', async (c) => okV1(await painelGovernanca(c.base)));

// ------------------------------------------------- download por link assinado
registrar('GET', 'arquivos/:token', async (c) => {
  const t = verificar(c.p.token);
  if (!t || !['doc', 'rel'].includes(t.t) || !t.u) {
    throw new ErroDeNegocio('NAO_AUTENTICADO', 'Este link venceu. Abra o arquivo de novo pelo sistema.');
  }
  const dono = await usuarioPorId(t.u);
  const arq = t.t === 'rel' ? await baixarRelatorio(dono, t.id) : await baixarDocumento(dono, t.id);
  return respostaDeArquivo({ ...arq, inline: arq.mimeType === 'application/pdf' || arq.mimeType.startsWith('image/') });
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

// =========================================================== atividades (015)
registrar('GET', 'eventos', async (c) => okV1(await listarEventos(await c.usuario())));
registrar('GET', 'eventos/configuracao', async (c) => okV1(configuracaoEventos(await c.usuario())));
registrar('POST', 'eventos', async (c) =>
  confirmadoV1(await salvarEvento(await c.usuario(), null, await c.json()), 201));
registrar('GET', 'eventos/:id', async (c) => okV1(await obterEvento(await c.usuario(), c.p.id)));
registrar('PATCH', 'eventos/:id', async (c) =>
  confirmadoV1(await salvarEvento(await c.usuario(), c.p.id, await c.json())));

registrar('GET', 'reunioes/:id/governanca', async (c) =>
  okV1({ registro: await obterGovernancaReuniao(await c.usuario(), c.p.id) }));
registrar('PATCH', 'reunioes/:id/governanca', async (c) =>
  confirmadoV1({ registro: await salvarGovernancaReuniao(await c.usuario(), c.p.id, await c.json()) }));

for (const [prefixo, natureza] of /** @type {const} */ ([['reunioes', 'reuniao'], ['eventos', 'evento']])) {
  registrar('GET', `${prefixo}/:id/credenciamento`, async (c) =>
    okV1(await obterCredenciamento(await c.usuario(), c.p.id, natureza, c.base)));
  registrar('POST', `${prefixo}/:id/credenciamento/abrir`, async (c) =>
    confirmadoV1(await abrirCredenciamento(await c.usuario(), c.p.id, natureza, await c.json())));
  registrar('POST', `${prefixo}/:id/credenciamento/encerrar`, async (c) =>
    confirmadoV1(await encerrarCredenciamento(await c.usuario(), c.p.id, natureza)));
  registrar('POST', `${prefixo}/:id/presencas`, async (c) =>
    confirmadoV1(await registrarPresencaManual(await c.usuario(), c.p.id, natureza, await c.json())));

  registrar('GET', `${prefixo}/:id/organizacao`, async (c) =>
    okV1(await obterOrganizacao(await c.usuario(), c.p.id, natureza)));
  registrar('POST', `${prefixo}/:id/convocacoes`, async (c) =>
    confirmadoV1(await convocar(await c.usuario(), c.p.id, natureza, await c.json()), 201));
  registrar('POST', `${prefixo}/:id/encaminhamentos`, async (c) =>
    confirmadoV1(await salvarEncaminhamento(await c.usuario(), c.p.id, natureza, null, await c.json()), 201));
  registrar('PATCH', `${prefixo}/:id/encaminhamentos/:eid`, async (c) => {
    if (!/^[0-9a-f-]{36}$/i.test(c.p.eid)) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Encaminhamento não encontrado.');
    return confirmadoV1(await salvarEncaminhamento(await c.usuario(), c.p.id, natureza, c.p.eid, await c.json()));
  });
}

registrar('GET', 'minha-instituicao/convocacoes', async (c) =>
  okV1(await convocacoesDaInstituicao(await c.usuario(), c.consulta.get('instituicaoId'))));
registrar('POST', 'minha-instituicao/convocacoes/:id/resposta', async (c) =>
  confirmadoV1(await responderConvocacao(await c.usuario(), c.p.id, await c.json())));

// ------------------------------------------------------- check-in e QR (público)
registrar('GET', 'checkin/:token', async (c) => {
  await exigirDentroDoLimite('consultar', ipDaRequisicao(c.req), c.p.token);
  return okV1(await abrirCheckin(c.p.token, await c.usuario()));
});
registrar('POST', 'checkin/:token', async (c) => {
  const ip = ipDaRequisicao(c.req);
  await exigirDentroDoLimite('registrar', ip, c.p.token);
  return confirmadoV1(await confirmarCheckin(c.p.token, await c.json(), { usuario: await c.usuario(), ip }), 201);
});
registrar('GET', 'qr/:token', async (c) => {
  const png = await imagemQr(c.p.token.replace(/\.png$/i, ''));
  return new Response(png, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// ======================================================= relatórios e importação (016)
registrar('POST', 'minha-instituicao/relatorios', async (c) =>
  okV1(await gerarRelatorio(await c.usuario(),
    { tipo: 'minha-instituicao', instituicaoPedida: c.consulta.get('instituicaoId') }, await c.json(), c.base)));
for (const prefixo of /** @type {const} */ (['reunioes', 'eventos'])) {
  registrar('POST', `${prefixo}/:id/relatorios`, async (c) =>
    okV1(await gerarRelatorio(await c.usuario(), { tipo: prefixo, id: c.p.id }, await c.json(), c.base)));
}

registrar('GET', 'importacoes', async (c) => okV1(await listarImportacoes(await c.usuario())));
registrar('POST', 'importacoes/validar', async (c) => {
  const { campos, arquivo } = await c.multipart(LIMITE_IMPORTACAO_BYTES);
  return okV1(await validarImportacao(await c.usuario(), campos.tipo, arquivo));
});
registrar('POST', 'importacoes/confirmar', async (c) =>
  confirmadoV1(await confirmarImportacao(await c.usuario(), await c.json())));
