/**
 * CASO DE USO — Criar reunião (RF23).
 *
 * O qr_token não é informado nem escolhido: o banco gera um aleatório de 16
 * bytes por padrão. Fosse derivado do id da reunião, quem conhecesse uma URL
 * conseguiria adivinhar a das outras.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaCriarReuniao, paraColunasReuniao } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 */
export async function criarReuniao(usuario, entrada) {
  const u = exigir(usuario, 'reuniao', 'criar');
  const dados = validar(esquemaCriarReuniao, entrada);

  const colunas = paraColunasReuniao(dados);
  colunas.created_by = u.id;

  const campos = Object.keys(colunas);
  const marcadores = campos.map((_, n) => `$${n + 1}`);

  return comUsuario(u.id, async (tx) => {
    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into reuniao (${campos.join(', ')})
              values (${marcadores.join(', ')})
           returning id, titulo, data, status, qr_token`,
        Object.values(colunas),
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite criar reuniões.');
    }

    // Convite em massa na mesma transação: se algo falhar, a reunião não fica
    // criada pela metade, com parte das instituições convidada.
    let convidados = 0;
    if (dados.convidarTodos) {
      exigir(usuario, 'presenca', 'criar');
      const r = await tx.consultaUm(
        'select convidar_representantes_ativos($1) as total', [linha.id],
      );
      convidados = Number(r?.total ?? 0);
    }

    return {
      id: linha.id,
      titulo: linha.titulo,
      data: linha.data,
      status: linha.status,
      convidados,
    };
  });
}
