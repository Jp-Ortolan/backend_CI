/**
 * CASOS DE USO — Contas e permissões (revisão de outubro).
 *
 * "Gerenciar contas e permissões: só o Administrador geral." Não existia rota
 * nenhuma para isso: contas eram criadas por script. Agora o admin cria a
 * conta da Diretoria e a de cada instituição pela API.
 *
 * O admin nunca escolhe nem vê a senha de ninguém: a conta nasce sem senha e a
 * pessoa recebe por e-mail o link para definir a dela (enviarConvite).
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ROTULO_PAPEL } from '@/dominio/permissoes.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { enviarConvite } from '@/aplicacao/autenticacao/recuperar-senha.js';
import { log } from '@/infraestrutura/observabilidade/log.js';

const PAPEIS = /** @type {const} */ (['admin', 'diretoria', 'representante']);

const objetoUsuario = z.object({
  nome: z.string().trim().min(3, 'Informe o nome.').max(200),
  email: z.string().trim().email('E-mail inválido.').transform((v) => v.toLowerCase()),
  papel: z.enum(PAPEIS, {
    errorMap: () => ({ message: 'Perfil inválido: admin, diretoria ou representante.' }),
  }),
  instituicaoId: z.string().uuid().nullable().optional(),
  pessoaId: z.string().uuid().nullable().optional(),
  ativo: z.boolean().optional(),
});

/** Conta de representante sem instituição não serve para nada. */
const exigeInstituicao = (/** @type {any} */ d) => d.papel !== 'representante' || !!d.instituicaoId;

export const esquemaCriarUsuario = objetoUsuario.refine(exigeInstituicao, {
  message: 'Conta de representante precisa estar ligada a uma instituição.',
  path: ['instituicaoId'],
});
export const esquemaEditarUsuario = objetoUsuario.partial();

export const esquemaFiltroUsuario = z.object({
  busca: z.string().trim().max(120).optional(),
  papel: z.enum(PAPEIS).optional(),
  instituicaoId: z.string().uuid().optional(),
  ativo: z.enum(['true', 'false']).optional(),
});

/** @param {any} l */
const formatar = (l) => ({
  id: l.id,
  nome: l.nome,
  email: l.email,
  papel: l.papel,
  rotuloPapel: ROTULO_PAPEL[/** @type {keyof typeof ROTULO_PAPEL} */ (l.papel)],
  ativo: l.ativo,
  instituicao: l.instituicao_id ? { id: l.instituicao_id, nome: l.instituicao_nome } : null,
  pessoa: l.pessoa_id ? { id: l.pessoa_id, nome: l.pessoa_nome } : null,
  senhaDefinida: l.senha_definida,
  ultimoLogin: l.ultimo_login,
  criadoEm: l.created_at,
  versaoRegistro: Number(l.versao_registro),
});

const SELECAO = `
  select u.id, u.nome, u.email, u.papel, u.ativo, u.instituicao_id, u.pessoa_id,
         u.ultimo_login, u.created_at, u.versao_registro, (u.senha_hash is not null) as senha_definida,
         i.nome as instituicao_nome, p.nome as pessoa_nome
    from usuario u
    left join instituicao i on i.id = u.instituicao_id
    left join pessoa      p on p.id = u.pessoa_id`;

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 */
export async function listarUsuarios(usuario, filtros) {
  const u = exigir(usuario, 'usuario', 'ver');
  const f = validar(esquemaFiltroUsuario, filtros ?? {});

  /** @type {string[]} */ const cond = [];
  /** @type {unknown[]} */ const val = [];
  if (f.busca) {
    val.push(f.busca);
    cond.push(`(imutavel_unaccent(lower(u.nome)) like '%' || imutavel_unaccent(lower($${val.length})) || '%'
                or u.email like '%' || lower($${val.length}) || '%')`);
  }
  if (f.papel) { val.push(f.papel); cond.push(`u.papel = $${val.length}::papel_usuario`); }
  if (f.instituicaoId) { val.push(f.instituicaoId); cond.push(`u.instituicao_id = $${val.length}`); }
  if (f.ativo) { val.push(f.ativo === 'true'); cond.push(`u.ativo = $${val.length}`); }

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `${SELECAO} ${cond.length ? `where ${cond.join(' and ')}` : ''}
       order by u.ativo desc, u.papel, u.nome`, val);
    return { dados: linhas.map(formatar), total: linhas.length };
  });
}

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 */
export async function criarUsuario(usuario, entrada) {
  const u = exigir(usuario, 'usuario', 'criar');
  const d = validar(esquemaCriarUsuario, entrada ?? {});

  const criado = await comUsuario(u.id, async (tx) => {
    await conferirLigacoes(tx, d);
    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into usuario (nome, email, papel, instituicao_id, pessoa_id, ativo)
         values ($1, $2, $3::papel_usuario, $4, $5, coalesce($6, true))
         returning id`,
        [d.nome, d.email, d.papel, d.papel === 'representante' ? d.instituicaoId : null,
          d.pessoaId ?? null, d.ativo ?? null]);
    } catch (e) { traduzirErroDoBanco(e); }
    if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Apenas o administrador cria contas.');
    return formatar(await tx.consultaUm(`${SELECAO} where u.id = $1`, [linha.id]));
  });

  // Depois do commit: o e-mail não deve sair se a conta não foi gravada. Se o
  // convite falhar, a conta continua criada e a resposta diz que o convite não
  // saiu (o admin reenvia por POST /api/usuarios/:id/convite).
  let conviteEnviado = true;
  try {
    await enviarConvite({
      email: criado.email, nome: criado.nome, perfil: criado.rotuloPapel,
      instituicao: criado.instituicao?.nome ?? null,
    });
  } catch (e) {
    conviteEnviado = false;
    log.erro('convite_nao_enviado', e);
  }

  return { ...criado, conviteEnviado };
}

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 * @param {{ versaoRegistro?: number|null }} [opcoes]  controle de concorrência (contrato /api/governanca)
 */
export async function editarUsuario(usuario, id, entrada, opcoes = {}) {
  const u = exigir(usuario, 'usuario', 'editar');
  const d = validar(esquemaEditarUsuario, entrada ?? {});

  if (id === u.id && (d.ativo === false || (d.papel && d.papel !== 'admin'))) {
    // Sem isso, o último admin se rebaixa e ninguém mais administra contas.
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      'Você não pode desativar nem rebaixar a sua própria conta. Peça a outro administrador.');
  }

  /** @type {Record<string, unknown>} */
  const c = {};
  if ('nome' in d) c.nome = d.nome;
  if ('email' in d) c.email = d.email;
  if ('papel' in d) c.papel = d.papel;
  if ('instituicaoId' in d) c.instituicao_id = d.instituicaoId ?? null;
  if ('pessoaId' in d) c.pessoa_id = d.pessoaId ?? null;
  if ('ativo' in d) c.ativo = d.ativo;
  if (!Object.keys(c).length) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm('select id, papel, instituicao_id, versao_registro from usuario where id = $1', [id]);
    if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Usuário não encontrado.');
    if (opcoes.versaoRegistro && Number(opcoes.versaoRegistro) !== Number(atual.versao_registro)) {
      throw new ErroDeNegocio('VERSAO_DESATUALIZADA',
        'Esta conta foi alterada por outra pessoa depois que você abriu a tela. Atualize e refaça.',
        { versaoAtual: Number(atual.versao_registro) });
    }

    const papelFinal = /** @type {string} */ (c.papel ?? atual.papel);
    const instFinal = 'instituicao_id' in c ? c.instituicao_id : atual.instituicao_id;
    if (papelFinal === 'representante' && !instFinal) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'Conta de representante precisa estar ligada a uma instituição.',
        { campos: [{ campo: 'instituicaoId', mensagem: 'Selecione a instituição.' }] });
    }
    // Gestão não é "de uma instituição": a ligação sairia do lugar errado.
    if (papelFinal !== 'representante') c.instituicao_id = null;

    // Nunca deixar o sistema sem administrador ativo.
    if (atual.papel === 'admin' && (papelFinal !== 'admin' || c.ativo === false)) {
      const outros = await tx.consultaUm(
        `select count(*)::int as n from usuario where papel = 'admin' and ativo and id <> $1`, [id]);
      if (!outros?.n) {
        throw new ErroDeNegocio('DADOS_INVALIDOS',
          'Esta é a única conta de administrador ativa. Crie ou ative outro administrador antes.');
      }
    }

    await conferirLigacoes(tx, { instituicaoId: c.instituicao_id, pessoaId: c.pessoa_id });

    const campos = Object.keys(c);
    let linha;
    try {
      linha = await tx.consultaUm(
        `update usuario set ${campos.map((k, n) => `${k} = $${n + 2}${k === 'papel' ? '::papel_usuario' : ''}`).join(', ')}
          where id = $1 returning id`,
        [id, ...Object.values(c)]);
    } catch (e) { traduzirErroDoBanco(e); }
    if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Apenas o administrador altera contas.');

    // Mudou perfil, instituição ou desativou: as sessões abertas caem, para a
    // pessoa não continuar navegando com a permissão antiga.
    if ('papel' in c || 'instituicao_id' in c || c.ativo === false) {
      await tx.consulta('select auth_encerrar_sessoes_do_usuario($1)', [id]);
    }

    return formatar(await tx.consultaUm(`${SELECAO} where u.id = $1`, [id]));
  });
}

/**
 * Reenvia o link de primeiro acesso (o anterior venceu ou se perdeu).
 *
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 */
export async function reenviarConvite(usuario, id) {
  const u = exigir(usuario, 'usuario', 'editar');
  const alvo = await comUsuario(u.id, (tx) => tx.consultaUm(`${SELECAO} where u.id = $1`, [id]));
  if (!alvo) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Usuário não encontrado.');
  if (!alvo.ativo) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Esta conta está desativada.');
  const f = formatar(alvo);
  await enviarConvite({ email: f.email, nome: f.nome, perfil: f.rotuloPapel, instituicao: f.instituicao?.nome ?? null });
  return { id, conviteEnviado: true };
}

/**
 * A instituição e a pessoa indicadas existem? (e a pessoa é da instituição)
 *
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {{ instituicaoId?: unknown, pessoaId?: unknown }} d
 */
async function conferirLigacoes(tx, d) {
  if (d.instituicaoId) {
    const i = await tx.consultaUm('select id from instituicao where id = $1', [d.instituicaoId]);
    if (!i) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');
  }
  if (d.pessoaId) {
    const p = await tx.consultaUm('select id from pessoa where id = $1', [d.pessoaId]);
    if (!p) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Pessoa não encontrada.');
    if (d.instituicaoId) {
      const v = await tx.consultaUm(
        `select 1 from vinculo where pessoa_id = $1 and instituicao_id = $2 and status = 'ativo'`,
        [d.pessoaId, d.instituicaoId]);
      if (!v) {
        throw new ErroDeNegocio('VINCULO_INVALIDO',
          'Esta pessoa não tem vínculo ativo com a instituição da conta.');
      }
    }
  }
}
