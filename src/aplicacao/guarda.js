/**
 * Porteiro dos casos de uso.
 *
 * Todo caso de uso começa igual: existe usuário? o papel dele permite esta
 * ação? Repetir essas seis linhas em cada arquivo é o tipo de duplicação que
 * um dia sai errada num arquivo só — e ninguém percebe, porque o teste do
 * arquivo certo continua passando.
 *
 * Isto NÃO substitui o RLS. É a primeira porta, para devolver 401/403 com
 * mensagem útil; a segunda porta é o banco, que recusa de novo mesmo que esta
 * aqui fosse contornada.
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
 *
 * Só a primeira mensagem vai para o `mensagem`, porque é ela que a tela mostra
 * em destaque; a lista completa vai em `campos`, para o front marcar cada campo
 * do formulário de uma vez em vez de o usuário descobrir um erro por tentativa.
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
