/**
 * Porteiro dos casos de uso: existe usuário? o papel dele permite esta ação?
 *
 * Não substitui o RLS. É a primeira porta, para devolver 401/403 com mensagem
 * útil; a segunda porta é o banco, que recusa de novo.
 */
import { pode } from '@/dominio/permissoes.js';
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
};

/** @type {Record<string, string>} */
const RECURSO_EM_TEXTO = {
  instituicao: 'instituições', representante: 'representantes',
  vinculo: 'vínculos', reuniao: 'reuniões', presenca: 'presenças',
  documento: 'documentos', usuario: 'usuários', indicador: 'indicadores',
};
