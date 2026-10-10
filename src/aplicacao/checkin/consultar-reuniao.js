/**
 * CASO DE USO — Abrir a página de check-in pelo QR Code (RF27).
 *
 * Toda a regra de "esta reunião aceita presença agora?" está na função
 * checkin_reuniao, dentro do banco. Aqui só se traduz o resultado.
 *
 * Revisão de outubro: "se estiver logado, os dados aparecem automaticamente".
 * Quem lê o QR já logado, com a conta ligada a uma pessoa do cadastro, recebe
 * os próprios dados em `voce` — a tela mostra "Confirmar minha presença" em vez
 * da busca por nome.
 */
import { consultaUm } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

/**
 * @param {string} token  o qr_token que veio na URL
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} [usuario]
 * @returns {Promise<object>}
 */
export async function consultarReuniao(token, usuario = null) {
  const r = await consultaUm('select * from checkin_reuniao($1)', [token]);

  if (!r) {
    throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA',
      'Não encontramos esta reunião. Confira o QR Code.');
  }

  /** @type {object|null} */
  let voce = null;
  if (usuario?.pessoaId) {
    // Mesma função de dono que o check-in usa: o participante pode não ter
    // permissão de ler a reunião pelo RLS, e não precisa.
    voce = await consultaUm('select * from checkin_quem_sou($1, $2)', [token, usuario.pessoaId]);
  }

  return {
    reuniao: {
      titulo: r.titulo,
      data: r.data,
      horaInicio: r.hora_inicio,
      local: r.local,
      natureza: r.natureza,
      tipo: r.tipo,
      modalidade: r.modalidade,
    },
    checkinAberto: r.aberto,
    permiteConvidado: r.permite_convidado,
    vagasRestantes: r.vagas_restantes,
    voce: voce
      ? {
        nome: voce.nome,
        instituicao: voce.instituicao,
        cargo: voce.cargo,
        podeRegistrar: voce.pode_registrar,
        jaRegistrado: voce.ja_registrado,
      }
      : null,
  };
}
