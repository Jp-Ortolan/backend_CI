/**
 * Exportações em CSV (abre no Excel) — revisão de outubro.
 *
 * "Gerar lista em PDF e Excel." O Excel sai daqui, como CSV pronto para o
 * Excel em português (ver infraestrutura/http/csv.js). O PDF continua sendo
 * montado no front a partir do JSON destas mesmas rotas: gerar PDF no servidor
 * exigiria uma biblioteca de layout só para repetir o que a tela já desenha.
 *
 * Quem pode exportar o quê é a mesma regra de quem pode ver: o RLS recorta a
 * lista do representante para a instituição dele ("relatório próprio").
 */
import { gerarCsv } from '@/infraestrutura/http/csv.js';
import { exigir } from '@/aplicacao/guarda.js';
import { listarParticipantes } from '@/aplicacao/convites/listar-participantes.js';
import { participacaoPorInstituicao } from './participacao.js';

const SITUACAO = {
  presente: 'Presente', ausente: 'Ausente', justificado: 'Justificado',
};

/**
 * Lista de presença da reunião ou do evento.
 *
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} reuniaoId
 * @param {unknown} filtros
 */
export async function exportarParticipantes(usuario, reuniaoId, filtros) {
  const u = exigir(usuario, 'presenca', 'exportar');
  const { dados } = await listarParticipantes(u, reuniaoId, filtros);
  const csv = gerarCsv([
    { chave: 'nome', titulo: 'Nome' },
    { chave: 'instituicao', titulo: 'Instituição' },
    { chave: 'cargo', titulo: 'Cargo' },
    { chave: 'tipo', titulo: 'Tipo' },
    { chave: 'representacao', titulo: 'Representação' },
    { chave: 'confirmacao', titulo: 'Confirmação' },
    { chave: 'situacao', titulo: 'Presença' },
    { chave: 'modo', titulo: 'Modo' },
    { chave: 'horario', titulo: 'Check-in' },
    { chave: 'origem', titulo: 'Origem' },
    { chave: 'assinado', titulo: 'Assinatura' },
    { chave: 'registradoPor', titulo: 'Registrado/corrigido por' },
    { chave: 'observacoes', titulo: 'Observações' },
  ], dados.map((p) => ({
    nome: p.nome,
    instituicao: p.instituicao,
    cargo: p.cargo,
    tipo: p.tipo,
    representacao: p.tipoRepresentacao,
    confirmacao: p.statusConfirmacao,
    situacao: p.statusPresenca ? SITUACAO[p.statusPresenca] ?? p.statusPresenca : 'Sem registro',
    modo: p.modo,
    horario: p.horarioCheckin ? new Date(p.horarioCheckin).toISOString() : null,
    origem: p.origemPresenca,
    assinado: p.assinadoEm ? 'Sim' : 'Não',
    registradoPor: p.registradoPor,
    observacoes: p.observacoes,
  })));
  return { nome: `lista-de-presenca-${reuniaoId}.csv`, mimeType: 'text/csv; charset=utf-8', conteudo: csv };
}

/**
 * Percentual de participação por instituição.
 *
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 */
export async function exportarParticipacao(usuario, filtros) {
  const { dados, periodo } = await participacaoPorInstituicao(usuario, filtros);
  const csv = gerarCsv([
    { chave: 'instituicao', titulo: 'Instituição' },
    { chave: 'status', titulo: 'Situação' },
    { chave: 'tipo', titulo: 'Tipo' },
    { chave: 'vertente', titulo: 'Vertente' },
    { chave: 'reunioesEsperadas', titulo: 'Reuniões esperadas' },
    { chave: 'reunioesComPresenca', titulo: 'Reuniões com presença' },
    { chave: 'reunioesJustificadas', titulo: 'Ausências justificadas' },
    { chave: 'percentual', titulo: 'Participação (%)' },
  ], dados.map((d) => ({ ...d, percentual: d.percentual === null ? '' : String(d.percentual).replace('.', ',') })));
  const sufixo = [periodo.de, periodo.ate].filter(Boolean).join('_a_') || 'geral';
  return { nome: `participacao-por-instituicao-${sufixo}.csv`, mimeType: 'text/csv; charset=utf-8', conteudo: csv };
}
