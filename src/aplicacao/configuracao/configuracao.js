/**
 * CASOS DE USO — Configurações do painel público (revisão de outubro).
 *
 * Link de manifestação de interesse, Linktree e canais oficiais. Ficam no
 * banco (tabela configuracao) para o admin trocar sem deploy.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

const url = z.string().trim().url('Informe o endereço completo, com https://')
  .refine((v) => /^https?:\/\//i.test(v), 'Só endereços http(s).');

export const esquemaConfiguracao = z.object({
  link_manifestacao_interesse: url.nullable(),
  linktree: url.nullable(),
  canais_oficiais: z.array(z.object({
    nome: z.string().trim().min(2).max(60),
    url,
  })).max(20),
}).partial();

/** @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario */
export async function obterConfiguracao(usuario) {
  const u = exigir(usuario, 'configuracao', 'ver');
  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta('select chave, valor, publico, updated_at from configuracao order by chave');
    return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  });
}

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 */
export async function salvarConfiguracao(usuario, entrada) {
  const u = exigir(usuario, 'configuracao', 'editar');
  const d = validar(esquemaConfiguracao, entrada ?? {});
  if (!Object.keys(d).length) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nada para gravar.');

  return comUsuario(u.id, async (tx) => {
    for (const [chave, valor] of Object.entries(d)) {
      const linha = await tx.consultaUm(
        `insert into configuracao (chave, valor, publico, updated_by) values ($1, $2, true, $3)
         on conflict (chave) do update set valor = excluded.valor, updated_by = excluded.updated_by
         returning chave`,
        [chave, JSON.stringify(valor), u.id]);
      if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Apenas o administrador altera configurações.');
    }
    const linhas = await tx.consulta('select chave, valor from configuracao order by chave');
    return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  });
}
