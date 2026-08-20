/**
 * Tipos do banco, escritos como JSDoc.
 *
 * Este arquivo não gera código nenhum: são só comentários. O VS Code lê estes
 * @typedef e passa a completar nomes de coluna e avisar quando um valor de
 * status está escrito errado — sem precisar de TypeScript no projeto.
 *
 * Para usar em outro arquivo:
 *
 *     /** @type {import('./tipos-banco.js').Instituicao} *\/
 *     const inst = ...
 */

/** @typedef {'em_processo_entrada'|'ativa'|'em_processo_saida'|'inativa'} StatusInstituicao */
/** @typedef {'ativo'|'encerrado'} StatusVinculo */
/** @typedef {'agendada'|'em_andamento'|'encerrada'|'cancelada'} StatusReuniao */
/** @typedef {'representante'|'convidado'} TipoParticipante */
/** @typedef {'presente'|'ausente'|'justificado'} StatusPresenca */
/** @typedef {'qrcode'|'manual'|'importacao'} OrigemPresenca */
/** @typedef {'admin'|'gestor'|'leitura'} PapelUsuario */

/**
 * @typedef {object} Instituicao
 * @property {string} id
 * @property {string} nome
 * @property {string|null} cnpj
 * @property {number|null} tipo_instituicao_id
 * @property {string|null} cidade
 * @property {string|null} uf
 * @property {string|null} email
 * @property {string|null} telefone
 * @property {string|null} site
 * @property {string|null} responsavel
 * @property {StatusInstituicao} status
 * @property {string|null} data_entrada
 * @property {string|null} data_saida
 * @property {string|null} observacoes
 */

/**
 * @typedef {object} Pessoa
 * @property {string} id
 * @property {string} nome
 * @property {string|null} email
 * @property {string|null} telefone
 */

/**
 * @typedef {object} Vinculo
 * @property {string} id
 * @property {string} pessoa_id
 * @property {string} instituicao_id
 * @property {string|null} cargo
 * @property {StatusVinculo} status
 * @property {string} data_inicio
 * @property {string|null} data_fim
 */

/**
 * @typedef {object} Reuniao
 * @property {string} id
 * @property {string} titulo
 * @property {string} data
 * @property {string|null} hora_inicio
 * @property {string|null} hora_fim
 * @property {string|null} local
 * @property {string|null} descricao
 * @property {string|null} pauta
 * @property {StatusReuniao} status
 * @property {string} qr_token
 * @property {string|null} checkin_abre_em
 * @property {string|null} checkin_fecha_em
 */

/**
 * @typedef {object} Presenca
 * @property {string} id
 * @property {string} reuniao_id
 * @property {string|null} pessoa_id
 * @property {string|null} vinculo_id
 * @property {string|null} instituicao_id
 * @property {string|null} cargo_no_momento
 * @property {TipoParticipante} tipo
 * @property {StatusPresenca} status
 * @property {OrigemPresenca} origem
 * @property {string|null} horario_checkin
 * @property {string|null} nome_informado
 * @property {string|null} email_informado
 * @property {string|null} instituicao_informada
 */

export {};
