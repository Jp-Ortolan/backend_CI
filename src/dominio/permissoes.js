/**
 * Matriz de permissões — RF03, revista em outubro para os perfis do Fórum.
 *
 * Fonte única do que cada perfil pode fazer. O banco repete a mesma regra em
 * RLS (migrations 001 e 008), então perfil ou recurso novo muda aqui E lá.
 *
 * PERFIS
 *   admin          Administrador geral — tudo, inclusive contas e exclusão.
 *   diretoria      Diretoria do Fórum — cadastra, aprova, cria reuniões e
 *                  eventos, corrige presença. Não exclui e não mexe em contas.
 *   representante  Conta de UMA instituição — consulta o Fórum, cuida dos
 *                  dados da própria instituição e PEDE o que é sensível.
 *   (público)      Sem login. Não é papel: são as rotas /api/publico e o
 *                  check-in por QR Code.
 *
 * ESCOPO
 * A matriz responde "este perfil faz esta ação neste recurso?". Para o
 * representante a resposta "sim" vale SÓ dentro da instituição dele — quem
 * recorta é o RLS no banco e os casos de uso (ver `escopoDe`).
 */

/** @typedef {import('./tipos.js').PapelUsuario} Papel */

/**
 * @typedef {'instituicao'|'representante'|'vinculo'|'reuniao'|'evento'
 *   |'presenca'|'documento'|'usuario'|'indicador'|'solicitacao'
 *   |'relatorio'|'configuracao'} Recurso
 */

/** @typedef {'ver'|'criar'|'editar'|'encerrar'|'excluir'|'exportar'|'aprovar'} Acao */

/** @type {Acao[]} */
const TODAS = ['ver', 'criar', 'editar', 'encerrar', 'excluir', 'exportar', 'aprovar'];
/** @type {Acao[]} */
const GESTAO = ['ver', 'criar', 'editar', 'encerrar', 'exportar', 'aprovar'];
/** @type {Acao[]} */
const SOMENTE_VER = ['ver'];

/** @type {Record<Papel, Record<Recurso, Acao[]>>} */
const MATRIZ = {
  admin: {
    instituicao: TODAS, representante: TODAS, vinculo: TODAS, reuniao: TODAS,
    evento: TODAS, presenca: TODAS, documento: TODAS, usuario: TODAS,
    indicador: ['ver', 'exportar'], solicitacao: TODAS,
    relatorio: ['ver', 'exportar'], configuracao: ['ver', 'editar'],
  },
  // "Excluir registros definitivamente: preferencialmente não." Diretoria
  // cancela, inativa e encerra — o histórico fica.
  diretoria: {
    instituicao: GESTAO, representante: GESTAO, vinculo: GESTAO, reuniao: GESTAO,
    evento: GESTAO, presenca: GESTAO, documento: GESTAO, usuario: [],
    indicador: ['ver', 'exportar'], solicitacao: GESTAO,
    relatorio: ['ver', 'exportar'], configuracao: ['ver'],
  },
  // Tudo "da própria instituição". `editar` em instituição = só os campos de
  // contato; o resto vira solicitação. `encerrar` em solicitação = cancelar a
  // própria. `criar` em documento = anexar ofício, termo e logo da instituição.
  representante: {
    instituicao: ['ver', 'editar'], representante: SOMENTE_VER, vinculo: SOMENTE_VER,
    reuniao: SOMENTE_VER, evento: SOMENTE_VER, presenca: ['ver', 'exportar'],
    documento: ['ver', 'criar'], usuario: [],
    indicador: SOMENTE_VER, solicitacao: ['ver', 'criar', 'encerrar'],
    relatorio: ['ver', 'exportar'], configuracao: [],
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
  if (!papel || !MATRIZ[papel]) return false;
  return (MATRIZ[papel][recurso] ?? []).includes(acao);
}

/**
 * Todas as ações que o perfil tem sobre um recurso.
 *
 * @param {Papel} papel
 * @param {Recurso} recurso
 * @returns {Acao[]}
 */
export function acoesDe(papel, recurso) {
  return [...(MATRIZ[papel]?.[recurso] ?? [])];
}

/**
 * A matriz inteira de um perfil, para o front mostrar ou esconder botões sem
 * reescrever a regra na tela.
 *
 * @param {Papel} papel
 * @returns {Record<Recurso, Acao[]>}
 */
export function permissoesDe(papel) {
  const m = MATRIZ[papel] ?? {};
  return /** @type {Record<Recurso, Acao[]>} */ (
    Object.fromEntries(Object.entries(m).map(([r, a]) => [r, [...a]])));
}

/**
 * Administra o Fórum (vê tudo)? Admin e Diretoria.
 *
 * @param {Papel|null|undefined} papel
 */
export function ehGestao(papel) {
  return papel === 'admin' || papel === 'diretoria';
}

/**
 * Até onde vai o que o usuário enxerga.
 *   'tudo'        — admin e diretoria
 *   'instituicao' — representante: só a instituição dele
 *
 * @param {Papel|null|undefined} papel
 * @returns {'tudo'|'instituicao'}
 */
export function escopoDe(papel) {
  return ehGestao(papel) ? 'tudo' : 'instituicao';
}

/**
 * Rótulo do perfil para exibição.
 *
 * @type {Record<Papel, string>}
 */
export const ROTULO_PAPEL = {
  admin: 'Administrador geral',
  diretoria: 'Diretoria',
  representante: 'Representante da instituição',
};

/** @typedef {{ rotulo: string, href: string, recurso: Recurso }} ItemMenu */

/**
 * Menu lateral de cada perfil. Escrito por perfil, e não derivado de "pode
 * ver", porque era exatamente isso que fazia os três perfis enxergarem o mesmo
 * menu: todos podiam VER tudo, então todos tinham os mesmos itens.
 *
 * @type {Record<Papel, ItemMenu[]>}
 */
export const MENU = {
  admin: [
    { rotulo: 'Dashboard',       href: '/dashboard',       recurso: 'indicador' },
    { rotulo: 'Instituições',    href: '/instituicoes',    recurso: 'instituicao' },
    { rotulo: 'Representantes',  href: '/representantes',  recurso: 'representante' },
    { rotulo: 'Reuniões',        href: '/reunioes',        recurso: 'reuniao' },
    { rotulo: 'Eventos',         href: '/eventos',         recurso: 'evento' },
    { rotulo: 'Presenças',       href: '/presencas',       recurso: 'presenca' },
    { rotulo: 'Solicitações',    href: '/solicitacoes',    recurso: 'solicitacao' },
    { rotulo: 'Documentos',      href: '/documentos',      recurso: 'documento' },
    { rotulo: 'Relatórios',      href: '/relatorios',      recurso: 'relatorio' },
    { rotulo: 'Usuários',        href: '/usuarios',        recurso: 'usuario' },
    { rotulo: 'Configurações',   href: '/configuracoes',   recurso: 'configuracao' },
  ],
  diretoria: [
    { rotulo: 'Dashboard',       href: '/dashboard',       recurso: 'indicador' },
    { rotulo: 'Instituições',    href: '/instituicoes',    recurso: 'instituicao' },
    { rotulo: 'Representantes',  href: '/representantes',  recurso: 'representante' },
    { rotulo: 'Reuniões',        href: '/reunioes',        recurso: 'reuniao' },
    { rotulo: 'Eventos',         href: '/eventos',         recurso: 'evento' },
    { rotulo: 'Presenças',       href: '/presencas',       recurso: 'presenca' },
    { rotulo: 'Solicitações',    href: '/solicitacoes',    recurso: 'solicitacao' },
    { rotulo: 'Documentos',      href: '/documentos',      recurso: 'documento' },
    { rotulo: 'Relatórios',      href: '/relatorios',      recurso: 'relatorio' },
  ],
  representante: [
    { rotulo: 'Dashboard',        href: '/dashboard',         recurso: 'indicador' },
    { rotulo: 'Minha instituição',href: '/minha-instituicao', recurso: 'instituicao' },
    { rotulo: 'Instituições',     href: '/instituicoes',      recurso: 'instituicao' },
    { rotulo: 'Reuniões',         href: '/reunioes',          recurso: 'reuniao' },
    { rotulo: 'Eventos',          href: '/eventos',           recurso: 'evento' },
    { rotulo: 'Presenças',        href: '/presencas',         recurso: 'presenca' },
    { rotulo: 'Solicitações',     href: '/solicitacoes',      recurso: 'solicitacao' },
  ],
};

/**
 * @param {Papel} papel
 * @returns {ItemMenu[]}
 */
export function menuDoPapel(papel) {
  return (MENU[papel] ?? []).filter((i) => pode(papel, i.recurso, 'ver'));
}
