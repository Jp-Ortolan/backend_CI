/**
 * Porteiro dos casos de uso: existe usuário? o papel dele permite esta ação?
 *
 * Não substitui o RLS. É a primeira porta, para devolver 401/403 com mensagem
 * útil; a segunda porta é o banco, que recusa de novo.
 */
import { pode, ehGestao } from '@/dominio/permissoes.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null|undefined} usuario
 * @param {import('@/dominio/permissoes.js').Recurso} recurso
 * @param {import('@/dominio/permissoes.js').Acao} acao
 * @returns {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao}
 */
export function exigir(usuario, recurso, acao) {
  if (!usuario) {
    throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
  }
  if (!usuario.ativo) {
    throw new ErroDeNegocio('NAO_AUTENTICADO', 'Este acesso está desativado.');
  }
  if (!pode(usuario.papel, recurso, acao)) {
    throw new ErroDeNegocio('SEM_PERMISSAO',
      `Seu perfil não permite ${ACAO_EM_TEXTO[acao]} ${RECURSO_EM_TEXTO[recurso]}.`);
  }
  return usuario;
}

/**
 * A instituição do representante. Conta de representante sem instituição não
 * tem o que fazer na área da instituição — a mensagem diz o que falta.
 *
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} usuario
 * @returns {string}
 */
export function instituicaoDoRepresentante(usuario) {
  if (!usuario.instituicaoId) {
    throw new ErroDeNegocio('CONTA_SEM_INSTITUICAO',
      'Sua conta ainda não está ligada a uma instituição. '
      + 'Peça ao administrador para concluir o cadastro.');
  }
  return usuario.instituicaoId;
}

/**
 * Para o representante, a ação só vale na PRÓPRIA instituição. A gestão passa
 * direto. O RLS recusaria de novo no banco; aqui é para a resposta ser 403 com
 * mensagem, e não um "não encontrado" confuso.
 *
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} usuario
 * @param {string|null|undefined} instituicaoId
 */
export function exigirInstituicaoPropria(usuario, instituicaoId) {
  if (ehGestao(usuario.papel)) return;
  const propria = instituicaoDoRepresentante(usuario);
  if (instituicaoId !== propria) {
    throw new ErroDeNegocio('SEM_PERMISSAO',
      'Seu perfil só permite esta ação na sua própria instituição.');
  }
}

/**
 * Valida a entrada com um esquema zod e devolve o erro no formato do contrato.
 * A primeira mensagem vai em `mensagem`, que é a que a tela destaca; a lista
 * completa vai em `campos`, para o front marcar todos os campos de uma vez.
 *
 * @template T
 * @param {import('zod').ZodType<T>} esquema
 * @param {unknown} entrada
 * @returns {T}
 */
export function validar(esquema, entrada) {
  const analise = esquema.safeParse(entrada);
  if (analise.success) return analise.data;

  const campos = analise.error.issues.map((i) => ({
    campo: i.path.join('.') || null,
    mensagem: i.message,
  }));

  throw new ErroDeNegocio(
    'DADOS_INVALIDOS',
    campos[0]?.mensagem ?? 'Dados inválidos.',
    { campos },
  );
}

/** @type {Record<string, string>} */
const ACAO_EM_TEXTO = {
  ver: 'consultar', criar: 'cadastrar', editar: 'editar',
  encerrar: 'encerrar', excluir: 'excluir', exportar: 'exportar',
  aprovar: 'aprovar',
};

/** @type {Record<string, string>} */
const RECURSO_EM_TEXTO = {
  instituicao: 'instituições', representante: 'representantes',
  vinculo: 'vínculos', reuniao: 'reuniões', presenca: 'presenças',
  documento: 'documentos', usuario: 'usuários', indicador: 'indicadores',
  evento: 'eventos', solicitacao: 'solicitações', relatorio: 'relatórios',
  configuracao: 'configurações',
};
