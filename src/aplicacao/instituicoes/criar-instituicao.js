/**
 * CASO DE USO — Cadastrar instituição (RF06, RF13).
 *
 * Tela "Nova instituição". O formulário chega em camelCase; o banco fala
 * snake_case; a tradução acontece só em esquemas.js.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaCriar, paraColunas } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 * @returns {Promise<{ id: string, nome: string, status: string }>}
 */
export async function criarInstituicao(usuario, entrada) {
  const u = exigir(usuario, 'instituicao', 'criar');
  const dados = validar(esquemaCriar, entrada);

  const colunas = paraColunas(dados);

  // A tela não pergunta a data de entrada, mas o período de participação da
  // instituição depende dela. Uma instituição cadastrada como ativa entra hoje.
  if (!colunas.data_entrada && (dados.status === 'ativa' || dados.status === 'em_processo_entrada')) {
    colunas.data_entrada = new Date().toISOString().slice(0, 10);
  }

  colunas.created_by = u.id;
  colunas.updated_by = u.id;

  const campos = Object.keys(colunas);
  const marcadores = campos.map((_, n) => `$${n + 1}`);

  return comUsuario(u.id, async (tx) => {
    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into instituicao (${campos.join(', ')})
              values (${marcadores.join(', ')})
           returning id, nome, status`,
        Object.values(colunas),
      );
    } catch (e) {
      // CNPJ repetido, CEP torto, descrição grande demais: o banco recusa e a
      // tradução transforma o nome da constraint em código do contrato.
      traduzirErroDoBanco(e);
    }

    // Falta de política de INSERT levanta erro e cai no catch acima. Ainda
    // assim, um returning vazio aqui significaria que algo saiu do previsto —
    // e é melhor falhar alto do que devolver um id indefinido.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Não foi possível cadastrar a instituição.');
    }

    return { id: linha.id, nome: linha.nome, status: linha.status };
  });
}
