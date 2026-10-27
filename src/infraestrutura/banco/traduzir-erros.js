import { ErroDeNegocio } from '@/dominio/erros.js';

/**
 * As funções de check-in levantam exceção com uma palavra-chave; aqui ela vira o
 * código do contrato e a mensagem em português. Ver docs/04-contrato-de-api.md
 *
 * @type {Record<string, [import('@/dominio/erros.js').CodigoErro, string]>}
 */
const MAPA = {
  REUNIAO_NAO_ENCONTRADA: ['REUNIAO_NAO_ENCONTRADA',
    'Não encontramos esta reunião. Confira o QR Code.'],
  REUNIAO_CANCELADA: ['REUNIAO_CANCELADA', 'Esta reunião foi cancelada.'],
  CHECKIN_FECHADO: ['CHECKIN_FECHADO',
    'O registro de presença desta reunião não está aberto neste momento.'],
  VINCULO_INVALIDO: ['VINCULO_INVALIDO',
    'Não encontramos um vínculo institucional válido para você nesta data.'],
  PESSOA_NAO_ENCONTRADA: ['VINCULO_INVALIDO', 'Participante não encontrado.'],
  NOME_INVALIDO: ['DADOS_INVALIDOS', 'Informe seu nome completo.'],
  TERMO_CURTO: ['DADOS_INVALIDOS', 'Digite ao menos 3 letras do nome.'],

  // ------------------------------------------------- migration 002, Sprint 1
  // Levantados pela trigger que protege o histórico da instituição.
  INSTITUICAO_COM_HISTORICO: ['INSTITUICAO_COM_HISTORICO',
    'Esta instituição já participou de reuniões e não pode ser excluída. '
    + 'Você pode desativá-la.'],
  INSTITUICAO_COM_VINCULO: ['INSTITUICAO_COM_VINCULO',
    'Esta instituição tem representantes vinculados. Encerre os vínculos antes '
    + 'de excluir, ou desative a instituição.'],

  // ------------------------------------------------- migration 003, Bloco B
  REUNIAO_COM_PRESENCA: ['REUNIAO_COM_PRESENCA',
    'Esta reunião já tem presenças registradas e não pode ser excluída. '
    + 'Cancele a reunião — o histórico continua preservado.'],
  REUNIAO_COM_DOCUMENTO: ['REUNIAO_COM_DOCUMENTO',
    'Esta reunião tem documentos anexados. Remova os documentos antes, '
    + 'ou cancele a reunião.'],

  // ------------------------------------------------- migration 004, Bloco C
  INSTITUICAO_COM_DOCUMENTO: ['INSTITUICAO_COM_DOCUMENTO',
    'Esta instituição tem documentos anexados. Remova os documentos antes, '
    + 'ou desative a instituição.'],

  // ------------------------------------------ migrations 008 a 010 (outubro)
  // Levantados pelas guardas que impedem o representante de mudar o que é
  // decisão da Diretoria, mesmo que a aplicação deixe passar.
  ALTERACAO_EXIGE_APROVACAO: ['ALTERACAO_EXIGE_APROVACAO',
    'Esta alteração precisa ser aprovada pela Diretoria. Abra uma solicitação.'],
  SEM_PERMISSAO_CONTA: ['SEM_PERMISSAO',
    'Perfil, instituição e situação da conta são definidos pelo administrador.'],
  CONVIDADO_NAO_PERMITIDO: ['CONVIDADO_NAO_PERMITIDO',
    'Esta atividade não aceita registro de convidados. Procure a organização.'],
  LIMITE_ATINGIDO: ['LIMITE_ATINGIDO',
    'O limite de participantes desta atividade já foi atingido.'],
  PESSOA_COM_HISTORICO: ['PESSOA_COM_HISTORICO',
    'Esta pessoa já participou de reuniões e não pode ser excluída. Encerre o vínculo.'],
  PESSOA_COM_CONTA: ['PESSOA_COM_HISTORICO',
    'Esta pessoa tem uma conta de acesso. Desative a conta antes de excluir.'],
  MODO_INVALIDO: ['DADOS_INVALIDOS',
    'Modo de participação inválido para esta atividade.'],
};

/**
 * Restrições de unicidade e verificação, pelo nome que têm no banco.
 * O nome só muda com migration; o texto da mensagem muda com a versão do Postgres.
 *
 * @type {Record<string, [import('@/dominio/erros.js').CodigoErro, string]>}
 */
const RESTRICOES = {
  instituicao_cnpj_key: ['CNPJ_DUPLICADO',
    'Já existe uma instituição cadastrada com este CNPJ.'],
  pessoa_email_key: ['EMAIL_DUPLICADO',
    'Já existe um representante cadastrado com este e-mail.'],
  usuario_email_key: ['EMAIL_DUPLICADO',
    'Já existe um usuário com este e-mail.'],
  vinculo_ativo_unico: ['VINCULO_DUPLICADO',
    'Esta pessoa já tem um vínculo ativo com esta instituição.'],
  convite_vinculo_unico: ['VINCULO_DUPLICADO',
    'Este representante já foi convidado para esta reunião.'],
  presenca_pessoa_unica: ['PRESENCA_JA_REGISTRADA',
    'A presença desta pessoa já está registrada nesta reunião.'],

  instituicao_descricao_tamanho: ['DADOS_INVALIDOS',
    'A descrição não pode passar de 500 caracteres.'],
  instituicao_cep_digitos: ['DADOS_INVALIDOS',
    'CEP inválido. Use apenas os 8 dígitos.'],
  instituicao_cnpj_digitos: ['DADOS_INVALIDOS',
    'CNPJ inválido. Use apenas os 14 dígitos.'],
  instituicao_fundacao_no_passado: ['DADOS_INVALIDOS',
    'A data de fundação não pode estar no futuro.'],
  instituicao_inativa_tem_saida: ['DATA_SAIDA_OBRIGATORIA',
    'Para inativar a instituição é preciso informar a data de saída.'],
  instituicao_saida_apos_entrada: ['DADOS_INVALIDOS',
    'A data de saída não pode ser anterior à data de entrada.'],
  vinculo_fim_apos_inicio: ['DATA_FIM_ANTERIOR_AO_INICIO',
    'A data de encerramento não pode ser anterior à de início.'],

  documento_tem_dono: ['DADOS_INVALIDOS',
    'O documento precisa pertencer a uma instituição ou a uma reunião.'],
  documento_arquivo_ou_link: ['DADOS_INVALIDOS',
    'Envie um arquivo ou informe um link, não os dois.'],
  documento_link_http: ['DADOS_INVALIDOS',
    'O link precisa começar com http:// ou https://.'],
  documento_storage_path_key: ['DADOS_INVALIDOS',
    'Já existe um documento gravado neste caminho.'],

  // ------------------------------------------ migrations 008 a 011 (outubro)
  vinculo_titular_unico: ['REPRESENTACAO_DUPLICADA',
    'Esta instituição já tem um titular vigente. Encerre o atual ou use a troca de titular.'],
  vinculo_suplente_unico: ['REPRESENTACAO_DUPLICADA',
    'Esta instituição já tem um suplente vigente. Encerre o atual ou use a troca de suplente.'],
  usuario_pessoa_unica: ['DADOS_INVALIDOS',
    'Esta pessoa já tem um acesso ao sistema.'],
  reuniao_numero_por_tipo: ['NUMERO_DUPLICADO',
    'Já existe uma atividade deste tipo com este número.'],
  instituicao_desligada_tem_saida: ['DATA_SAIDA_OBRIGATORIA',
    'Para desligar a instituição é preciso informar a data de saída.'],
  instituicao_nao_substitui_a_si: ['DADOS_INVALIDOS',
    'A instituição não pode ser a própria substituta.'],
  reuniao_inscricao_http: ['DADOS_INVALIDOS',
    'O link de inscrição precisa começar com http:// ou https://.'],
  reuniao_limite_positivo: ['DADOS_INVALIDOS',
    'O limite de participantes precisa ser maior que zero.'],
  encaminhamento_concluido_tem_data: ['DADOS_INVALIDOS',
    'Informe a data de conclusão do encaminhamento.'],
  documento_versao_positiva: ['DADOS_INVALIDOS', 'Versão inválida.'],
  configuracao_pkey: ['DADOS_INVALIDOS', 'Configuração já existe.'],
  vertente_nome_key: ['DADOS_INVALIDOS', 'Já existe uma vertente com este nome.'],
  grupo_trabalho_nome_key: ['DADOS_INVALIDOS', 'Já existe um GT com este nome.'],
  tipo_atividade_nome_key: ['DADOS_INVALIDOS', 'Já existe um tipo de atividade com este nome.'],
};

/**
 * Traduz a exceção do banco. O que não for conhecido passa direto, para erro
 * inesperado não virar mensagem amigável que esconde defeito.
 *
 * @param {unknown} e
 * @returns {never}
 */
export function traduzirErroDoBanco(e) {
  const erro = /** @type {{ message?: unknown, constraint?: unknown }} */ (
    e && typeof e === 'object' ? e : {}
  );

  const restricao = typeof erro.constraint === 'string' ? erro.constraint : '';
  if (restricao && RESTRICOES[restricao]) {
    const [codigo, texto] = RESTRICOES[restricao];
    throw new ErroDeNegocio(codigo, texto);
  }

  const msg = typeof erro.message === 'string' ? erro.message : '';
  for (const [chave, [codigo, texto]] of Object.entries(MAPA)) {
    if (msg.includes(chave)) throw new ErroDeNegocio(codigo, texto);
  }

  throw e;
}
