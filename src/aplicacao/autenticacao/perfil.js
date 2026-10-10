/**
 * O que o front precisa saber sobre quem está logado.
 *
 * Além dos dados da conta: o papel já resolvido, o menu daquele perfil, a
 * matriz de permissões (para mostrar ou esconder botões sem reescrever a regra
 * na tela) e, para o representante, a instituição dele.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import {
  menuDoPapel, permissoesDe, escopoDe, ROTULO_PAPEL,
} from '@/dominio/permissoes.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} u
 */
export async function montarPerfil(u) {
  /** @type {{id: string, nome: string, status: string}|null} */
  let instituicao = null;
  if (u.instituicaoId) {
    instituicao = await comUsuario(u.id, (tx) => tx.consultaUm(
      'select id, nome, status from instituicao where id = $1', [u.instituicaoId],
    ));
  }

  /** @type {string[]} */
  const avisos = [];
  if (u.papel === 'representante' && !instituicao) {
    // Os acessos "leitura" antigos viraram representante sem instituição.
    // Eles entram, mas não enxergam nada da área da instituição até o admin
    // ligar a conta a uma.
    avisos.push('Sua conta ainda não está ligada a uma instituição. '
      + 'Peça ao administrador para concluir o cadastro.');
  }

  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    papel: u.papel,
    rotuloPapel: ROTULO_PAPEL[u.papel],
    escopo: escopoDe(u.papel),
    instituicao: instituicao
      ? { id: instituicao.id, nome: instituicao.nome, status: instituicao.status }
      : null,
    pessoaId: u.pessoaId ?? null,
    menu: menuDoPapel(u.papel),
    permissoes: permissoesDe(u.papel),
    avisos,
  };
}
