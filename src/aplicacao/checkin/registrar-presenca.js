/**
 * CASO DE USO — Registrar a presença no check-in público (RF29 a RF34).
 *
 * O participante não tem conta. Quem garante que só se pode gravar presença
 * numa reunião aberta, com o vínculo válido NA DATA da reunião, é a função
 * checkin_registrar dentro do banco — não este arquivo.
 */
import { z } from 'zod';
import { consultaUm } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';

/** Ou a pessoa já cadastrada, ou um convidado que se identifica na hora. */
export const esquemaPresenca = z.union([
  z.object({ pessoaId: z.string().uuid() }),
  z.object({
    convidado: z.object({
      nome: z.string().trim().min(3, 'Informe seu nome completo.'),
      email: z.string().trim().email().optional().or(z.literal('')),
      instituicao: z.string().trim().optional().or(z.literal('')),
    }),
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
 * @returns {Promise<object>}
 */
export async function registrarPresenca(token, entrada) {
  const analise = esquemaPresenca.safeParse(entrada);
  if (!analise.success) {
    throw new ErroDeNegocio('DADOS_INVALIDOS',
      analise.error.issues[0]?.message ?? 'Dados inválidos.');
  }

  const d = analise.data;
  const args = 'convidado' in d
    ? [token, null, d.convidado.nome,
       d.convidado.email || null, d.convidado.instituicao || null]
    : [token, d.pessoaId, null, null, null];

  /** @type {Registro|null} */
  let linha = null;
  try {
    linha = await consultaUm('select * from checkin_registrar($1, $2, $3, $4, $5)', args);
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
  };

  // Já tinha registrado: para o participante isso é sucesso, não erro (RF34).
  // Ele fez a coisa certa duas vezes; a tela precisa dizer que está tudo bem.
  if (linha.out_ja_existia) {
    throw new ErroDeNegocio('PRESENCA_JA_REGISTRADA',
      'Sua presença já estava registrada.', resultado);
  }

  return resultado;
}
