/**
 * CASO DE USO — Cadastrar instituição (RF06, RF13).
 *
 * Tela "Nova instituição". O formulário chega em camelCase; o banco fala
 * snake_case; a tradução acontece só em esquemas.js.
 *
 * Dois jeitos de começar (revisão de outubro):
 *   completo  — a Diretoria já tem tudo e cadastra direto (inclusive ativa);
 *   rascunho  — a Diretoria abre só com o nome, cria o acesso do representante
 *               e a instituição completa o resto pela área dela.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import {
  esquemaCriar, esquemaRascunho, paraColunas, gravarGruposDaInstituicao,
} from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 * @returns {Promise<{ id: string, nome: string, status: string }>}
 */
export async function criarInstituicao(usuario, entrada) {
  const u = exigir(usuario, 'instituicao', 'criar');

  const pedido = /** @type {any} */ (entrada ?? {});
  const rascunho = !pedido.status || ['rascunho', 'aguardando_documentos'].includes(pedido.status);
  const dados = rascunho ? validar(esquemaRascunho, pedido) : validar(esquemaCriar, pedido);

  const colunas = paraColunas(dados);

  // A tela não pergunta a data de entrada, mas o período de participação da
  // instituição depende dela. Uma instituição cadastrada já ativa entra hoje.
  // Rascunho não tem data: ela é gravada quando a Diretoria aprova a entrada.
  if (!colunas.data_entrada && dados.status === 'ativa') {
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
      if (linha && dados.grupoTrabalhoIds) {
        await gravarGruposDaInstituicao(tx, linha.id, dados.grupoTrabalhoIds);
      }
    } catch (e) {
      // CNPJ repetido, CEP torto, descrição grande demais: o banco recusa e a
      // tradução transforma o nome da constraint em código do contrato.
      traduzirErroDoBanco(e);
    }

// Um returning vazio significa que algo saiu do previsto: melhor falhar alto
// do que devolver um id indefinido.
    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Não foi possível cadastrar a instituição.');
    }

    return { id: linha.id, nome: linha.nome, status: linha.status };
  });
}
