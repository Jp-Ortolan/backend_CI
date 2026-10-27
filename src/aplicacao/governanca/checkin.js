/**
 * Check-in pelo QR no contrato /api/governanca (aceita visitante ou sessão):
 *
 *   GET  /checkin/:token
 *   POST /checkin/:token   { nome, email, instituicaoId, modalidade, assinatura }
 *
 * Quem a pessoa é sai da SESSÃO, nunca do corpo: logado com conta ligada a uma
 * pessoa do cadastro, registra como representante pelo vínculo da data;
 * visitante é sempre convidado (não se autodeclara representante nem equipe).
 * Atividade aberta, limite, convidado permitido e duplicidade são conferidos
 * pelas funções do banco, na gravação.
 */
import { z } from 'zod';
import { comUsuario, consulta, consultaUm } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { validar } from '@/aplicacao/guarda.js';
import { isoComFuso } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */

const TOKEN = /^[0-9a-f]{32}$/;

/** @param {string} token */
async function atividadeDoToken(token) {
  if (!TOKEN.test(token)) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'QR Code inválido. Confira o link.');
  const r = await consultaUm('select * from checkin_reuniao($1)', [token]);
  if (!r) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Não encontramos esta atividade. O QR pode ter sido substituído.');
  return r;
}

/** Instituições que o público pode escolher: as que autorizaram divulgação. */
const opcoesPublicas = async () => (await consulta('select id, coalesce(nome_fantasia, nome) as nome from publico_instituicoes()'))
  .map((i) => ({ id: i.id, nome: i.nome }));

/**
 * @param {string} token
 * @param {Usuario|null} usuario
 */
export async function abrirCheckin(token, usuario) {
  const r = await atividadeDoToken(token);

  /** @type {any} */
  let participante = null;
  /** @type {{ id: string, nome: string }[]} */
  let instituicoes;
  if (usuario?.pessoaId) {
    const eu = await consultaUm('select * from checkin_quem_sou($1, $2)', [token, usuario.pessoaId]);
    // A instituição do vínculo vigente NA DATA (mesma regra do check-in).
    const inst = eu?.pode_registrar
      ? await comUsuario(usuario.id, (tx) => tx.consultaUm(
        `select i.id, coalesce(i.nome_fantasia, i.nome) as nome
           from reuniao r
           join vinculo v on v.pessoa_id = $2 and v.data_inicio <= r.data
                         and (v.data_fim is null or v.data_fim >= r.data)
           join instituicao i on i.id = v.instituicao_id
          where r.qr_token = $1
          order by (v.status = 'ativo') desc, (v.tipo_representacao = 'titular') desc, v.data_inicio desc
          limit 1`, [token, usuario.pessoaId]))
      : null;
    participante = {
      nome: eu?.nome ?? usuario.nome,
      email: usuario.email ?? null,
      instituicaoId: inst?.id ?? null,
      instituicao: eu?.instituicao ?? null,
      tipo: eu?.pode_registrar ? 'representante' : 'convidado',
      jaRegistrado: !!eu?.ja_registrado,
    };
    // Logado: só a instituição que a pessoa representa naquela data.
    instituicoes = inst ? [{ id: inst.id, nome: inst.nome }] : [];
  } else if (usuario) {
    participante = { nome: usuario.nome, email: usuario.email ?? null, instituicaoId: null, tipo: 'convidado', jaRegistrado: false };
    instituicoes = await opcoesPublicas();
  } else {
    instituicoes = r.permite_convidado ? await opcoesPublicas() : [];
  }

  return {
    aberto: !!r.aberto,
    permiteConvidados: !!r.permite_convidado,
    vagasRestantes: r.vagas_restantes ?? null,
    atividade: {
      titulo: r.titulo,
      tipo: r.natureza,
      data: r.data,
      horaInicio: r.hora_inicio ? String(r.hora_inicio).slice(0, 5) : null,
      local: r.local ?? '',
      modalidade: r.modalidade,
    },
    participante,
    instituicoes,
  };
}

const esquema = z.object({
  nome: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable()
    .refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), 'E-mail inválido.'),
  instituicaoId: z.string().trim().optional().nullable(),
  modalidade: z.enum(['presencial', 'online']).optional().nullable(),
  assinatura: z.string({ required_error: 'Digite seu nome completo como assinatura.' })
    .trim().min(3, 'Digite seu nome completo como assinatura.').max(200),
  tipo: z.string().optional(),  // ignorado: o tipo efetivo é decidido aqui
});

/**
 * @param {string} token
 * @param {unknown} corpo
 * @param {{ usuario: Usuario|null, ip: string|null }} ctx
 */
export async function confirmarCheckin(token, corpo, ctx) {
  await atividadeDoToken(token);
  const d = validar(esquema, corpo ?? {});
  const u = ctx.usuario;

  /** @type {unknown[]} */
  let args;
  if (u?.pessoaId) {
    args = [token, u.pessoaId, null, null, null];
  } else {
    const nome = (u ? u.nome : d.nome) ?? '';
    if (nome.trim().length < 3) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe seu nome completo.',
        { campos: [{ campo: 'nome', mensagem: 'Informe seu nome completo.' }] });
    }
    // A instituição do convidado é só informativa, e só entre as públicas.
    let instituicao = null;
    if (d.instituicaoId) {
      instituicao = (await opcoesPublicas()).find((i) => i.id === d.instituicaoId)?.nome ?? null;
      if (!instituicao) {
        throw new ErroDeNegocio('DADOS_INVALIDOS', 'Instituição indisponível para seleção.',
          { campos: [{ campo: 'instituicaoId', mensagem: 'Selecione uma instituição da lista.' }] });
      }
    }
    args = [token, null, nome.trim(), (u ? u.email : d.email) || null, instituicao];
  }
  args.push(d.modalidade ?? null, ctx.ip ?? null, d.assinatura);

  let linha = null;
  try {
    linha = await consultaUm('select * from checkin_registrar_assinado($1, $2, $3, $4, $5, $6, $7, $8)', args);
  } catch (e) {
    traduzirErroDoBanco(e);
  }
  if (!linha) throw new ErroDeNegocio('ERRO_INTERNO', 'Não foi possível registrar a presença.');
  if (linha.out_ja_existia) {
    throw new ErroDeNegocio('PRESENCA_JA_REGISTRADA', 'Sua presença já estava registrada nesta atividade.',
      { presenca: { id: linha.out_presenca_id, horarioCheckin: isoComFuso(linha.out_registrado_em) } });
  }
  return {
    presenca: {
      id: linha.out_presenca_id,
      horarioCheckin: isoComFuso(linha.out_registrado_em),
      tipo: linha.out_tipo,
      instituicao: linha.out_instituicao,
    },
  };
}
