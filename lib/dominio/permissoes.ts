/**
 * Matriz de permissões — RF03.
 *
 * Esta é a fonte única de "o que cada perfil enxerga e pode fazer".
 * A interface usa isto para mostrar ou esconder ações; o banco repete a mesma
 * regra em RLS (migration 006), porque interface não é controle de acesso.
 *
 * Quando um perfil novo ou um recurso novo entrar, muda-se AQUI e na migration —
 * nos dois lugares, sempre.
 */
import type { PapelUsuario } from '../tipos-banco';

export type Papel = PapelUsuario;

export type Recurso =
  | 'instituicao' | 'representante' | 'vinculo' | 'reuniao'
  | 'presenca' | 'documento' | 'usuario' | 'indicador';

export type Acao = 'ver' | 'criar' | 'editar' | 'encerrar' | 'excluir' | 'exportar';

const TODAS: Acao[] = ['ver', 'criar', 'editar', 'encerrar', 'excluir', 'exportar'];
const ESCRITA: Acao[] = ['ver', 'criar', 'editar', 'encerrar', 'exportar'];
const SOMENTE_VER: Acao[] = ['ver'];

const MATRIZ: Record<Papel, Record<Recurso, Acao[]>> = {
  admin: {
    instituicao: TODAS, representante: TODAS, vinculo: TODAS, reuniao: TODAS,
    presenca: TODAS, documento: TODAS, usuario: TODAS, indicador: ['ver', 'exportar'],
  },
  gestor: {
    // Gestor opera o dia a dia, mas não apaga registro nem administra usuários:
    // exclusão de instituição ou de vínculo destruiria histórico de participação.
    instituicao: ESCRITA, representante: ESCRITA, vinculo: ESCRITA, reuniao: ESCRITA,
    presenca: ESCRITA, documento: ESCRITA, usuario: [], indicador: ['ver', 'exportar'],
  },
  leitura: {
    instituicao: SOMENTE_VER, representante: SOMENTE_VER, vinculo: SOMENTE_VER,
    reuniao: SOMENTE_VER, presenca: SOMENTE_VER, documento: SOMENTE_VER,
    usuario: [], indicador: SOMENTE_VER,
  },
};

/** O perfil pode executar esta ação neste recurso? */
export function pode(papel: Papel | null | undefined, recurso: Recurso, acao: Acao): boolean {
  if (!papel) return false;
  return MATRIZ[papel][recurso].includes(acao);
}

/** Todas as ações que o perfil tem sobre um recurso. Útil para montar menus. */
export function acoesDe(papel: Papel, recurso: Recurso): Acao[] {
  return [...MATRIZ[papel][recurso]];
}

/** Rótulo do perfil para exibição. */
export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  leitura: 'Consulta',
};

/** Itens do menu lateral que cada perfil enxerga. */
export const MENU: { rotulo: string; href: string; recurso: Recurso }[] = [
  { rotulo: 'Dashboard',       href: '/dashboard',       recurso: 'indicador' },
  { rotulo: 'Instituições',    href: '/instituicoes',    recurso: 'instituicao' },
  { rotulo: 'Representantes',  href: '/representantes',  recurso: 'representante' },
  { rotulo: 'Reuniões',        href: '/reunioes',        recurso: 'reuniao' },
  { rotulo: 'Presenças',       href: '/presencas',       recurso: 'presenca' },
  { rotulo: 'Documentos',      href: '/documentos',      recurso: 'documento' },
  { rotulo: 'Usuários',        href: '/usuarios',        recurso: 'usuario' },
];

export function menuDoPapel(papel: Papel) {
  return MENU.filter(i => pode(papel, i.recurso, 'ver'));
}
