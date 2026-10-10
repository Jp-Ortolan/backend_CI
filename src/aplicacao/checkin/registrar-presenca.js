/**
 * CASO DE USO — Registrar a presença no check-in (RF29 a RF34).
 *
 * Três jeitos de chegar aqui:
 *   { pessoaId }           achou o próprio nome na busca (sem login)
 *   { convidado: {...} }   não está no cadastro e se identifica na hora
 *   { proprio: true }      está LOGADO: a pessoa vem da conta, não do corpo
 *
 * Nos três, opcionalmente: `modo` (presencial / online) e `assinar` — a
 * assinatura eletrônica simples ("declaro que estive presente"), que grava a
 * hora e o IP junto da presença.
 *
 * Quem garante atividade aberta, vínculo válido NA DATA, limite de vagas e
 * convidado permitido é a função checkin_registrar, dentro do banco.
 */
import { z } from 'zod';
import { consultaUm } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';

const extras = {
  modo: z.enum(['presencial', 'online']).optional(),
  assinar: z.boolean().optional().default(false),
};

export const esquemaPresenca = z.union([
  z.object({ proprio: z.literal(true), ...extras }),
  z.object({ pessoaId: z.string().uuid(), ...extras }),
  z.object({
    convidado: z.object({
      nome: z.string().trim().min(3, 'Informe seu nome completo.'),
      email: z.string().trim().email().optional().or(z.literal('')),
      instituicao: z.string().trim().optional().or(z.literal('')),
    }),
    ...extras,
  }),
]);

/**
 * @typedef {object} Registro
 * @property {string} out_presenca_id
 * @property {string} out_participante
 * @property {string|null} out_instituicao
 * @property {string|null} out_cargo
 * @property {'representante'|'convidado'} out_tipo
 * @property {string} out_registrado_em
 * @property {boolean} out_ja_existia
 */

/**
 * @param {string} token
 * @param {unknown} entrada  corpo da requisição, ainda sem validar
 * @param {{ usuario?: import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null,
 *           ip?: string|null }} [contexto]
 * @returns {Promise<object>}
 */
export async function registrarPresenca(token, entrada, contexto = {}) {
  const analise = esquemaPresenca.safeParse(entrada);
  if (!analise.success) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      analise.error.issues[0]?.message ?? 'Dados inválidos.');
  }

  const d = /** @type {any} */ (analise.data);

  /** @type {string|null} */
  let pessoaId = null;
  if (d.proprio) {
    // "Própria presença": quem está logado só registra a si mesmo. A pessoa
    // sai da sessão, nunca do corpo da requisição.
    if (!contexto.usuario) {
      throw new ErroDeNegocio('NAO_AUTENTICADO', 'Entre no sistema para confirmar sua presença.');
    }
    if (!contexto.usuario.pessoaId) {
      throw new ErroDeNegocio('VINCULO_INVALIDO',
        'Sua conta não está ligada a um representante do cadastro. Busque seu nome na lista.');
    }
    pessoaId = contexto.usuario.pessoaId;
  } else if (d.pessoaId) {
    pessoaId = d.pessoaId;
  }

  const args = pessoaId
    ? [token, pessoaId, null, null, null]
    : [token, null, d.convidado.nome, d.convidado.email || null, d.convidado.instituicao || null];
  args.push(d.modo ?? null, d.assinar ?? false, d.assinar ? (contexto.ip ?? null) : null);

  /** @type {Registro|null} */
  let linha = null;
  try {
    linha = await consultaUm(
      'select * from checkin_registrar($1, $2, $3, $4, $5, $6, $7, $8)', args);
  } catch (e) { traduzirErroDoBanco(e); }

  if (!linha) {
    throw new ErroDeNegocio('ERRO_INTERNO', 'Não foi possível registrar a presença.');
  }

  const resultado = {
    presencaId: linha.out_presenca_id,
    nome: linha.out_participante,
    instituicao: linha.out_instituicao,
    cargo: linha.out_cargo,
    tipo: linha.out_tipo,
    horarioCheckin: linha.out_registrado_em,
    assinado: !!d.assinar,
  };

  // Já tinha registrado: para o participante isso é sucesso, não erro (RF34).
  // Ele fez a coisa certa duas vezes; a tela precisa dizer que está tudo bem.
  if (linha.out_ja_existia) {
    throw new ErroDeNegocio('PRESENCA_JA_REGISTRADA',
      'Sua presença já estava registrada.', resultado);
  }

  return resultado;
}
