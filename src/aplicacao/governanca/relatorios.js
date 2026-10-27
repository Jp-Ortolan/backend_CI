/**
 * Relatórios oficiais (xlsx de verdade e PDF) no contrato /api/governanca:
 *
 *   POST /{escopo}/relatorios   { inicio, fim, formato: xlsx|pdf }
 *   escopo = minha-instituicao | reunioes/:id | eventos/:id
 *
 * O arquivo fica guardado por 1 hora, só para quem gerou, e sai por link
 * assinado de 15 minutos (/arquivos/:token). Período inclusivo. A regra do
 * percentual é a mesma do painel e da área da instituição.
 *
 * Planilha: texto que começa com = + - @ (ou tab/CR) vira texto com apóstrofo
 * na frente — conteúdo digitado por usuário não pode virar fórmula.
 */
import { z } from 'zod';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { assinar } from '@/infraestrutura/seguranca/assinatura.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { instituicaoDaSessao } from './minha-instituicao.js';
import { isoComFuso, presencaContrato } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */
/** @typedef {{ titulo: string, linhas: [string, unknown][], tabelas: { nome: string, colunas: string[], linhas: unknown[][] }[] }} Conteudo */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const esquema = z.object({
  inicio: z.string().regex(DATA, 'Informe a data inicial.'),
  fim: z.string().regex(DATA, 'Informe a data final.'),
  formato: z.enum(['xlsx', 'pdf'], { errorMap: () => ({ message: 'Formato: xlsx ou pdf.' }) }),
}).refine((d) => d.fim >= d.inicio, { message: 'A data final não pode ser antes da inicial.', path: ['fim'] });

const ROTULO_STATUS = { presente: 'Presente', ausente: 'Ausente', justificada: 'Justificada', prevista: 'Prevista', cancelada: 'Cancelada' };

/** Texto perigoso numa planilha vira texto inofensivo. */
export function celulaSegura(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// ------------------------------------------------------------- conteúdo

/**
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {string} instituicaoId
 * @param {{ inicio: string, fim: string }} p
 * @returns {Promise<Conteudo>}
 */
async function conteudoInstituicao(tx, instituicaoId, p) {
  const i = await tx.consultaUm('select id, coalesce(nome_fantasia, nome) as nome, cnpj from instituicao where id = $1', [instituicaoId]);
  if (!i) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');
  const r = await tx.consultaUm(
    `select count(distinct e.reuniao_id) as esperadas,
            count(distinct pr.reuniao_id) filter (where pr.status = 'presente') as com_presenca,
            count(distinct pr.reuniao_id) filter (where pr.status = 'justificado') as justificadas
       from vw_reuniao_esperada e
       left join presenca pr on pr.reuniao_id = e.reuniao_id and pr.instituicao_id = e.instituicao_id
      where e.instituicao_id = $1 and e.reuniao_data between $2::date and $3::date`,
    [instituicaoId, p.inicio, p.fim]);
  const esperadas = Number(r?.esperadas ?? 0);
  const com = Number(r?.com_presenca ?? 0);

  const atividades = await tx.consulta(
    `select r.data, r.natureza, t.nome as tipo, r.titulo, r.status, r.conta_participacao,
            bool_or(p.status = 'presente') as presente, bool_or(p.status = 'justificado') as justificada
       from reuniao r
       left join tipo_atividade t on t.id = r.tipo_atividade_id
       left join presenca p on p.reuniao_id = r.id and p.instituicao_id = $1
      where r.status <> 'rascunho' and r.data between $2::date and $3::date
        and (p.id is not null
             or exists (select 1 from vw_reuniao_esperada e where e.reuniao_id = r.id and e.instituicao_id = $1)
             or exists (select 1 from convocacao c where c.reuniao_id = r.id and c.instituicao_id = $1))
      group by r.id, t.nome order by r.data`, [instituicaoId, p.inicio, p.fim]);

  const presencas = await tx.consulta(
    `select r.data, r.titulo, coalesce(pe.nome, p.nome_informado) as nome, p.tipo, p.status, p.modo, p.horario_checkin
       from presenca p
       join reuniao r on r.id = p.reuniao_id
       left join pessoa pe on pe.id = p.pessoa_id
      where p.instituicao_id = $1 and r.data between $2::date and $3::date
      order by r.data, 3`, [instituicaoId, p.inicio, p.fim]);

  return {
    titulo: `Participação — ${i.nome}`,
    linhas: [
      ['Instituição', i.nome],
      ['CNPJ', i.cnpj ?? ''],
      ['Período', `${p.inicio} a ${p.fim}`],
      ['Atividades elegíveis (denominador)', esperadas],
      ['Atividades com presença (numerador)', com],
      ['Ausências justificadas', Number(r?.justificadas ?? 0)],
      ['Percentual de participação', esperadas ? `${Math.round((1000 * com) / esperadas) / 10}%` : 'não se aplica (nenhuma atividade elegível)'],
      ['Regra', 'Atividades encerradas que contam no percentual oficial, com vínculo vigente da instituição na data; '
        + 'a instituição conta no máximo uma vez por atividade; convidados e equipe não contam.'],
    ],
    tabelas: [
      {
        nome: 'Atividades',
        colunas: ['Data', 'Natureza', 'Tipo', 'Título', 'Conta no percentual', 'Situação da instituição'],
        linhas: atividades.map((a) => [a.data, a.natureza, a.tipo ?? '', a.titulo, a.conta_participacao ? 'Sim' : 'Não',
          ROTULO_STATUS[a.presente ? 'presente' : a.justificada ? 'justificada' : a.status === 'encerrada' ? 'ausente'
            : a.status === 'cancelada' ? 'cancelada' : 'prevista']]),
      },
      {
        nome: 'Presenças',
        colunas: ['Data', 'Atividade', 'Participante', 'Tipo', 'Situação', 'Modalidade', 'Check-in'],
        linhas: presencas.map((x) => [x.data, x.titulo, x.nome, x.tipo, ROTULO_STATUS[presencaContrato(x.status)] ?? x.status,
          x.modo ?? '', isoComFuso(x.horario_checkin) ?? '']),
      },
    ],
  };
}

/**
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {string} id
 * @param {'reuniao'|'evento'} natureza
 * @param {{ inicio: string, fim: string }} p
 * @returns {Promise<Conteudo>}
 */
async function conteudoAtividade(tx, id, natureza, p) {
  const r = await tx.consultaUm(
    `select r.*, t.nome as tipo from reuniao r left join tipo_atividade t on t.id = r.tipo_atividade_id where r.id = $1`, [id]);
  if (!r || r.natureza !== natureza) {
    throw new ErroDeNegocio('NAO_ENCONTRADO', natureza === 'evento' ? 'Evento não encontrado.' : 'Reunião não encontrada.');
  }
  if (r.data < p.inicio || r.data > p.fim) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', `A atividade é de ${r.data}, fora do período informado.`,
      { campos: [{ campo: 'inicio', mensagem: 'O período precisa incluir a data da atividade.' }] });
  }
  const lista = await tx.consulta(
    `select coalesce(pe.nome, p.nome_informado) as nome, coalesce(i.nome, p.instituicao_informada) as instituicao,
            p.tipo, p.status, p.modo, p.horario_checkin, p.origem, p.assinatura_nome is not null as assinou
       from presenca p
       left join pessoa pe on pe.id = p.pessoa_id
       left join instituicao i on i.id = p.instituicao_id
      where p.reuniao_id = $1 order by 2 nulls last, 1`, [id]);
  const presentes = lista.filter((l) => l.status === 'presente');
  const instituicoes = new Set(presentes.filter((l) => l.tipo === 'representante').map((l) => l.instituicao));

  return {
    titulo: `${natureza === 'evento' ? 'Evento' : 'Reunião'} — ${r.titulo}`,
    linhas: [
      ['Atividade', r.titulo],
      ['Tipo', r.tipo ?? natureza],
      ['Data', `${r.data}${r.hora_inicio ? ` ${String(r.hora_inicio).slice(0, 5)}` : ''}`],
      ['Local', [r.local, r.endereco].filter(Boolean).join(' · ')],
      ['Modalidade', r.modalidade],
      ['Conta no percentual oficial', r.conta_participacao ? 'Sim' : 'Não'],
      ['Presentes', presentes.length],
      ['Instituições representadas', instituicoes.size],
      ['Convidados e equipe presentes', presentes.filter((l) => l.tipo !== 'representante').length],
    ],
    tabelas: [{
      nome: 'Participantes',
      colunas: ['Participante', 'Instituição', 'Tipo', 'Situação', 'Modalidade', 'Check-in', 'Origem', 'Assinou'],
      linhas: lista.map((l) => [l.nome, l.instituicao ?? '', l.tipo, ROTULO_STATUS[presencaContrato(l.status)] ?? l.status,
        l.modo ?? '', isoComFuso(l.horario_checkin) ?? '', l.origem, l.assinou ? 'Sim' : 'Não']),
    }],
  };
}

// ------------------------------------------------------------- arquivos

/** @param {Conteudo} c */
export async function gerarXlsx(c) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema do Fórum CTI';
  wb.created = new Date();
  const resumo = wb.addWorksheet('Resumo');
  resumo.addRow([celulaSegura(c.titulo)]).font = { bold: true, size: 14 };
  resumo.addRow([]);
  for (const [k, v] of c.linhas) resumo.addRow([celulaSegura(k), celulaSegura(v)]);
  resumo.getColumn(1).width = 40;
  resumo.getColumn(2).width = 80;
  for (const t of c.tabelas) {
    const ws = wb.addWorksheet(t.nome.slice(0, 31));
    ws.addRow(t.colunas).font = { bold: true };
    for (const l of t.linhas) ws.addRow(l.map(celulaSegura));
    ws.columns.forEach((col) => { col.width = 22; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** @param {Conteudo} c */
export function gerarPdf(c) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: c.titulo, Creator: 'Sistema do Fórum CTI' } });
    /** @type {Buffer[]} */ const partes = [];
    doc.on('data', (b) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(15).text(c.titulo);
    doc.moveDown(0.5).font('Helvetica').fontSize(8).fillColor('#555')
      .text(`Gerado em ${isoComFuso(new Date())?.replace('T', ' ').slice(0, 16)} (horário de Brasília)`).fillColor('#000');
    doc.moveDown();
    for (const [k, v] of c.linhas) {
      doc.font('Helvetica-Bold').fontSize(9).text(`${k}: `, { continued: true }).font('Helvetica').text(String(v ?? ''));
    }
    for (const t of c.tabelas) {
      doc.moveDown().font('Helvetica-Bold').fontSize(11).text(t.nome);
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(7.5).text(t.colunas.join('  |  '));
      doc.font('Helvetica').fontSize(7.5);
      if (!t.linhas.length) doc.text('Nenhum registro no período.');
      for (const l of t.linhas) doc.text(l.map((x) => String(x ?? '')).join('  |  '));
    }
    doc.end();
  });
}

// ------------------------------------------------------------- caso de uso

/**
 * @param {Usuario|null} usuario
 * @param {{ tipo: 'minha-instituicao'|'reunioes'|'eventos', id?: string, instituicaoPedida?: string|null }} escopo
 * @param {unknown} corpo
 * @param {string} base
 */
export async function gerarRelatorio(usuario, escopo, corpo, base) {
  const u = exigir(usuario, 'relatorio', 'exportar');
  const p = validar(esquema, corpo ?? {});
  if (escopo.tipo !== 'minha-instituicao' && !ehGestao(u.papel)) {
    throw new ErroDeNegocio('SEM_PERMISSAO', 'Relatórios de atividade são da Diretoria.');
  }

  return comUsuario(u.id, async (tx) => {
    const c = escopo.tipo === 'minha-instituicao'
      ? await conteudoInstituicao(tx, instituicaoDaSessao(u, escopo.instituicaoPedida), p)
      : await conteudoAtividade(tx, /** @type {string} */ (escopo.id), escopo.tipo === 'eventos' ? 'evento' : 'reuniao', p);

    const arquivo = p.formato === 'xlsx' ? await gerarXlsx(c) : await gerarPdf(c);
    const nome = `relatorio-${p.inicio}-a-${p.fim}.${p.formato}`;
    const mime = p.formato === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf';

    await tx.consulta('delete from relatorio_gerado where usuario_id = $1 and expira_em < now()', [u.id]);
    const l = await tx.consultaUm(
      `insert into relatorio_gerado (usuario_id, escopo, nome, mime_type, conteudo)
       values ($1, $2, $3, $4, $5) returning id`,
      [u.id, `${escopo.tipo}${escopo.id ? `/${escopo.id}` : ''}`, nome, mime, arquivo]);
    return {
      downloadUrl: `${base}/api/governanca/arquivos/${assinar({ t: 'rel', id: l.id, u: u.id })}`,
      nome,
      formato: p.formato,
      tamanhoBytes: arquivo.length,
    };
  });
}

/**
 * Bytes do relatório, para o link assinado.
 *
 * @param {Usuario} u  a conta do link (conferida de novo pelo RLS)
 * @param {string} id
 */
export async function baixarRelatorio(u, id) {
  const r = await comUsuario(u.id, (tx) => tx.consultaUm(
    'select nome, mime_type, conteudo from relatorio_gerado where id = $1 and usuario_id = $2 and expira_em > now()',
    [id, u.id]));
  if (!r) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Este relatório não está mais disponível. Gere de novo.');
  return { nome: r.nome, mimeType: r.mime_type, conteudo: r.conteudo };
}
