/**
 * CASO DE USO — Criar reunião ou evento (RF23, revisão de outubro).
 *
 * Reunião e evento são registros diferentes (`natureza`), na mesma tabela:
 * presença, convite e QR Code servem aos dois — ver o cabeçalho da migration
 * 010. Quem chama diz o que está criando: a rota /api/reunioes cria reunião,
 * a /api/eventos cria evento.
 *
 * O qr_token não é informado nem escolhido: o banco gera um aleatório de 16
 * bytes por padrão. Fosse derivado do id da reunião, quem conhecesse uma URL
 * conseguiria adivinhar a das outras.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaCriarReuniao, paraColunasReuniao, ROTULO_NATUREZA } from './esquemas.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 * @param {'reuniao'|'evento'} [natureza]
 */
export async function criarReuniao(usuario, entrada, natureza = 'reuniao') {
  const u = exigir(usuario, natureza, 'criar');
  const dados = validar(esquemaCriarReuniao, entrada);

  const colunas = paraColunasReuniao(dados);
  colunas.natureza = natureza;
  colunas.created_by = u.id;

  return comUsuario(u.id, async (tx) => {
    // O tipo tem que ser da mesma natureza: "Workshop" não vira reunião.
    if (dados.tipoAtividadeId) {
      const tipo = await tx.consultaUm(
        'select id, nome, natureza, conta_participacao_padrao from tipo_atividade where id = $1 and ativo',
        [dados.tipoAtividadeId]);
      if (!tipo) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Tipo de atividade não encontrado.');
      if (tipo.natureza !== natureza) {
        throw new ErroDeNegocio('DADOS_INVALIDOS',
          `"${tipo.nome}" é um tipo de ${ROTULO_NATUREZA[tipo.natureza].toLowerCase()}, `
          + `não de ${ROTULO_NATUREZA[natureza].toLowerCase()}.`,
          { campos: [{ campo: 'tipoAtividadeId', mensagem: 'Tipo de outra natureza.' }] });
      }
      if (!('conta_participacao' in colunas)) {
        colunas.conta_participacao = tipo.conta_participacao_padrao;
      }
    }
    // Sem tipo: reunião conta (como sempre contou), evento não.
    if (!('conta_participacao' in colunas)) colunas.conta_participacao = natureza === 'reuniao';

    const campos = Object.keys(colunas);
    const marcadores = campos.map((_, n) => `$${n + 1}`);

    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into reuniao (${campos.join(', ')})
              values (${marcadores.join(', ')})
           returning id, titulo, data, status, natureza, qr_token, conta_participacao`,
        Object.values(colunas),
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        `Seu perfil não permite criar ${natureza === 'evento' ? 'eventos' : 'reuniões'}.`);
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
      natureza: linha.natureza,
      data: linha.data,
      status: linha.status,
      contaParticipacao: linha.conta_participacao,
      convidados,
    };
  });
}
