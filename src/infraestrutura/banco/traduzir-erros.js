import { ErroDeNegocio } from '@/dominio/erros.js';

/**
 * As funções de check-in no banco sinalizam problema levantando exceção com
 * uma palavra-chave. Aqui essa palavra vira o código estável do contrato de API
 * e a mensagem em português que o participante lê.
 *
 * Ver docs/04-contrato-de-api.md
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
};

/**
 * Restrições de unicidade e de verificação, pelo NOME que têm no banco.
 *
 * Vale confiar no nome da constraint em vez de ler o texto da mensagem: o texto
 * muda com a versão e com o idioma do PostgreSQL, o nome não muda sem migration.
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
};

/**
 * Traduz a exceção do banco. Se não for uma das conhecidas, repassa como está —
 * erro inesperado tem que continuar sendo inesperado, e não virar uma mensagem
 * amigável que esconde um defeito de verdade.
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
