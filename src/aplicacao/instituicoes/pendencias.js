/**
 * O que falta para o cadastro da instituição poder ir para análise.
 *
 * Fica no servidor, e não só na tela, porque é ele que decide se "Enviar para
 * análise" passa: o botão desabilitado no front é conveniência; esta lista é a
 * regra. A mesma lista aparece no detalhe da instituição, para o representante
 * saber o que preencher.
 */

/** Campo obrigatório → texto que a tela mostra. */
const CAMPOS = {
  cnpj: 'CNPJ',
  data_fundacao: 'Data de fundação',
  telefone: 'Telefone',
  logradouro: 'Logradouro',
  bairro: 'Bairro',
  cidade: 'Cidade',
  uf: 'Estado',
  cep: 'CEP',
  tipo_instituicao_id: 'Tipo de instituição',
  area_atuacao_id: 'Área de atuação',
};

/** Tipos de documento que o Fórum exige para a adesão. */
export const DOCUMENTOS_EXIGIDOS = {
  oficio: 'Ofício de indicação dos representantes',
  termo_adesao: 'Termo de adesão assinado',
};

/**
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {string} instituicaoId
 * @returns {Promise<{ completo: boolean, itens: { campo: string, mensagem: string }[] }>}
 */
export async function pendenciasDoCadastro(tx, instituicaoId) {
  const i = await tx.consultaUm(
    `select i.*,
            exists (select 1 from vertente where ativo) as ha_vertentes,
            -- Titular vigente, OU a indicação dele já enviada à Diretoria:
            -- durante o cadastro a instituição indica, e a aprovação do
            -- titular pode sair junto com a aprovação da entrada.
            (exists (select 1 from vinculo v
                      where v.instituicao_id = i.id and v.status = 'ativo'
                        and v.tipo_representacao = 'titular')
             or exists (select 1 from solicitacao s
                         where s.instituicao_id = i.id and s.status = 'pendente'
                           and s.tipo = 'troca_titular')) as tem_titular,
            (select coalesce(array_agg(distinct d.tipo), '{}') from documento d
              where d.instituicao_id = i.id) as tipos_documento
       from instituicao i where i.id = $1`,
    [instituicaoId],
  );
  if (!i) return { completo: false, itens: [] };

  /** @type {{ campo: string, mensagem: string }[]} */
  const itens = [];

  for (const [coluna, rotulo] of Object.entries(CAMPOS)) {
    if (i[coluna] === null || i[coluna] === '') {
      itens.push({ campo: coluna, mensagem: `Preencha: ${rotulo}.` });
    }
  }

  // Vertente só é exigida depois que o Fórum cadastrou as vertentes.
  if (i.ha_vertentes && !i.vertente_id) {
    itens.push({ campo: 'vertente_id', mensagem: 'Selecione a vertente do ecossistema.' });
  }

  if (!i.tem_titular) {
    itens.push({ campo: 'titular', mensagem: 'Indique o representante titular.' });
  }

  const tipos = new Set(i.tipos_documento ?? []);
  for (const [tipo, rotulo] of Object.entries(DOCUMENTOS_EXIGIDOS)) {
    if (!tipos.has(tipo)) itens.push({ campo: `documento:${tipo}`, mensagem: `Anexe: ${rotulo}.` });
  }

  return { completo: itens.length === 0, itens };
}
