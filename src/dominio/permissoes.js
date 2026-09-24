/**
 * Matriz de permissões — RF03.
 * Fonte única do que cada perfil pode fazer. O banco repete a mesma regra em RLS,
 * então perfil ou recurso novo muda aqui E na migration.
 */

/** @typedef {import('./tipos.js').PapelUsuario} Papel */

/**
 * @typedef {'instituicao'|'representante'|'vinculo'|'reuniao'
 *   |'presenca'|'documento'|'usuario'|'indicador'} Recurso
 */

/** @typedef {'ver'|'criar'|'editar'|'encerrar'|'excluir'|'exportar'} Acao */

/** @type {Acao[]} */
const TODAS = ['ver', 'criar', 'editar', 'encerrar', 'excluir', 'exportar'];
/** @type {Acao[]} */
const ESCRITA = ['ver', 'criar', 'editar', 'encerrar', 'exportar'];
/** @type {Acao[]} */
const SOMENTE_VER = ['ver'];

/** @type {Record<Papel, Record<Recurso, Acao[]>>} */
const MATRIZ = {
  admin: {
    instituicao: TODAS, representante: TODAS, vinculo: TODAS, reuniao: TODAS,
    presenca: TODAS, documento: TODAS, usuario: TODAS, indicador: ['ver', 'exportar'],
  },
  gestor: {
// Gestor não exclui nem administra usuários: excluir destruiria histórico.
    instituicao: ESCRITA, representante: ESCRITA, vinculo: ESCRITA, reuniao: ESCRITA,
    presenca: ESCRITA, documento: ESCRITA, usuario: [], indicador: ['ver', 'exportar'],
  },
  leitura: {
    instituicao: SOMENTE_VER, representante: SOMENTE_VER, vinculo: SOMENTE_VER,
    reuniao: SOMENTE_VER, presenca: SOMENTE_VER, documento: SOMENTE_VER,
    usuario: [], indicador: SOMENTE_VER,
  },
};

/**
 * O perfil pode executar esta ação neste recurso?
 *
 * @param {Papel|null|undefined} papel
 * @param {Recurso} recurso
 * @param {Acao} acao
 * @returns {boolean}
 */
export function pode(papel, recurso, acao) {
  if (!papel) return false;
  return MATRIZ[papel][recurso].includes(acao);
}

/**
 * Todas as ações que o perfil tem sobre um recurso. Útil para montar menus.
 *
 * @param {Papel} papel
 * @param {Recurso} recurso
 * @returns {Acao[]}
 */
export function acoesDe(papel, recurso) {
  return [...MATRIZ[papel][recurso]];
}

/**
 * Rótulo do perfil para exibição.
 *
 * @type {Record<Papel, string>}
 */
export const ROTULO_PAPEL = {
  admin: 'Administrador',
  gestor: 'Gestor',
  leitura: 'Consulta',
};

/**
 * Itens do menu lateral que cada perfil enxerga.
 *
 * @type {{ rotulo: string, href: string, recurso: Recurso }[]}
 */
export const MENU = [
  { rotulo: 'Dashboard',       href: '/dashboard',       recurso: 'indicador' },
  { rotulo: 'Instituições',    href: '/instituicoes',    recurso: 'instituicao' },
  { rotulo: 'Representantes',  href: '/representantes',  recurso: 'representante' },
  { rotulo: 'Reuniões',        href: '/reunioes',        recurso: 'reuniao' },
  { rotulo: 'Presenças',       href: '/presencas',       recurso: 'presenca' },
  { rotulo: 'Documentos',      href: '/documentos',      recurso: 'documento' },
  { rotulo: 'Usuários',        href: '/usuarios',        recurso: 'usuario' },
];

/**
 * @param {Papel} papel
 */
export function menuDoPapel(papel) {
  return MENU.filter(i => pode(papel, i.recurso, 'ver'));
}
