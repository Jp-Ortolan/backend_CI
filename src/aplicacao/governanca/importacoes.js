/**
 * Importação em lote (só o administrador) no contrato /api/governanca:
 *
 *   GET  /importacoes
 *   POST /importacoes/validar     multipart: arquivo (CSV UTF-8, ";", até 5 MB) + tipo
 *   POST /importacoes/confirmar   { previaId }
 *
 * Validar não toca em registro oficial: grava uma PRÉVIA (da conta, do tipo e
 * do hash do arquivo, válida por 30 minutos). Confirmar revalida tudo contra o
 * banco de agora e grava numa transação só; com erro ou duplicidade, nada
 * entra. Confirmar de novo a mesma prévia devolve a mesma importação.
 */
import { createHash } from 'node:crypto';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { apenasDigitos, cnpjValido } from '@/dominio/cnpj.js';
import { horarioLocalParaIso, isoComFuso } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */
/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */

export const LIMITE_IMPORTACAO_BYTES = 5 * 1024 * 1024;
const MAX_LINHAS = 5000;

export const COLUNAS = {
  instituicoes: ['nomeFantasia', 'razaoSocial', 'cnpj', 'email', 'telefone', 'vertente', 'gts', 'dataIngresso'],
  presencas: ['atividadeTipo', 'atividadeId', 'pessoaId', 'instituicaoId', 'statusPresenca', 'modalidade',
    'horarioCheckin', 'justificativa'],
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^\S+@\S+\.\S+$/;

/** @param {Usuario|null} usuario */
function soAdmin(usuario) {
  if (!usuario || !usuario.ativo) throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
  if (usuario.papel !== 'admin') throw new ErroDeNegocio('SEM_PERMISSAO', 'Importação em lote é do administrador.');
  return usuario;
}

/**
 * CSV com ";" e aspas (RFC 4180, com ponto e vírgula).
 *
 * @param {string} texto
 * @returns {string[][]}
 */
export function lerCsv(texto) {
  /** @type {string[][]} */ const linhas = [];
  /** @type {string[]} */ let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i += 1; } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"' && campo === '') aspas = true;
    else if (c === ';') { linha.push(campo); campo = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      linha.push(campo); campo = '';
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
  return linhas;
}

/**
 * @param {Buffer} conteudo
 * @param {string} tipo
 */
function interpretar(conteudo, tipo) {
  if (conteudo.includes(0)) throw new ErroDeNegocio('TIPO_NAO_PERMITIDO', 'O arquivo não é um CSV de texto.');
  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(conteudo);
  } catch {
    throw new ErroDeNegocio('TIPO_NAO_PERMITIDO', 'O arquivo precisa estar em UTF-8. No Excel, salve como "CSV UTF-8".');
  }
  const tabela = lerCsv(texto.replace(/^﻿/, ''));
  if (!tabela.length) throw new ErroDeNegocio('DADOS_INVALIDOS', 'O arquivo está vazio.');
  const cabecalho = tabela[0].map((c) => c.trim());
  const esperadas = COLUNAS[tipo];
  const faltando = esperadas.filter((c) => !cabecalho.includes(c));
  if (faltando.length) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', `Faltam colunas no cabeçalho: ${faltando.join(', ')}. Use o modelo da tela.`,
      { colunasEsperadas: esperadas });
  }
  if (tabela.length - 1 > MAX_LINHAS) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', `O arquivo tem mais de ${MAX_LINHAS} linhas. Divida em partes.`);
  }
  const linhas = tabela.slice(1).map((l, n) => ({
    linha: n + 2,
    v: Object.fromEntries(esperadas.map((c) => [c, (l[cabecalho.indexOf(c)] ?? '').trim()])),
  }));
  return { colunas: esperadas, linhas };
}

/**
 * Valida as linhas contra o banco de agora. Devolve as normalizadas, os erros
 * e quantas eram duplicadas (no arquivo ou já cadastradas).
 *
 * @param {Transacao} tx
 * @param {string} tipo
 * @param {{ linha: number, v: Record<string, string> }[]} linhas
 */
async function conferir(tx, tipo, linhas) {
  /** @type {{ linha: number, mensagem: string }[]} */ const erros = [];
  /** @type {any[]} */ const validas = [];
  let duplicados = 0;
  const vistos = new Set();

  if (tipo === 'instituicoes') {
    const vertentes = new Map((await tx.consulta('select id, lower(nome) as nome from vertente where ativo')).map((x) => [x.nome, x.id]));
    const gts = new Map((await tx.consulta('select id, lower(nome) as nome from grupo_trabalho where ativo')).map((x) => [x.nome, x.id]));
    for (const { linha, v } of linhas) {
      const e = [];
      const nome = v.nomeFantasia;
      const cnpj = v.cnpj ? apenasDigitos(v.cnpj) : null;
      if (nome.length < 3) e.push('nomeFantasia obrigatório (mínimo 3 caracteres).');
      if (cnpj && !cnpjValido(cnpj)) e.push('CNPJ inválido.');
      if (v.email && !EMAIL.test(v.email)) e.push('E-mail inválido.');
      if (v.dataIngresso && (!DATA.test(v.dataIngresso) || Number.isNaN(new Date(v.dataIngresso).getTime()))) {
        e.push('dataIngresso inválida (AAAA-MM-DD).');
      }
      const vertenteId = v.vertente ? vertentes.get(v.vertente.toLowerCase()) : null;
      if (v.vertente && !vertenteId) e.push(`Vertente "${v.vertente}" não cadastrada.`);
      const gtIds = [];
      for (const g of v.gts.split(',').map((x) => x.trim()).filter(Boolean)) {
        const id = gts.get(g.toLowerCase());
        if (!id) e.push(`GT "${g}" não cadastrado.`); else gtIds.push(id);
      }
      const chave = cnpj ?? `nome:${nome.toLowerCase()}`;
      let dup = vistos.has(chave);
      vistos.add(chave);
      if (!dup && nome.length >= 3) {
        const existe = await tx.consultaUm(
          `select 1 from instituicao where ($1::text is not null and cnpj = $1)
              or nome_busca = imutavel_unaccent(lower($2))`, [cnpj, nome]);
        dup = !!existe;
      }
      if (dup) { duplicados += 1; e.push('Duplicada: mesma instituição no arquivo ou já cadastrada.'); }
      if (e.length) erros.push({ linha, mensagem: e.join(' ') });
      else {
        validas.push({
          nomeFantasia: nome, razaoSocial: v.razaoSocial || null, cnpj, email: v.email ? v.email.toLowerCase() : null,
          telefone: v.telefone || null, vertenteId, gtIds, dataIngresso: v.dataIngresso || null,
        });
      }
    }
  } else {
    for (const { linha, v } of linhas) {
      const e = [];
      const natureza = v.atividadeTipo === 'evento' ? 'evento' : v.atividadeTipo === 'reuniao' ? 'reuniao' : null;
      if (!natureza) e.push('atividadeTipo: reuniao ou evento.');
      if (!UUID.test(v.atividadeId)) e.push('atividadeId inválido.');
      if (!UUID.test(v.pessoaId)) e.push('pessoaId inválido.');
      if (v.instituicaoId && !UUID.test(v.instituicaoId)) e.push('instituicaoId inválido.');
      const status = { presente: 'presente', ausente: 'ausente', justificada: 'justificado' }[v.statusPresenca];
      if (!status) e.push('statusPresenca: presente, ausente ou justificada.');
      if (v.modalidade && !['presencial', 'online'].includes(v.modalidade)) e.push('modalidade: presencial ou online.');
      const horario = v.horarioCheckin ? horarioLocalParaIso(v.horarioCheckin) : null;
      if (v.horarioCheckin && !horario) e.push('horarioCheckin inválido.');
      if (status === 'presente' && !horario) e.push('horarioCheckin obrigatório para presente.');
      if (!v.justificativa || v.justificativa.length < 3) e.push('justificativa obrigatória.');

      let vinculo = null;
      if (!e.length) {
        const r = await tx.consultaUm('select id, data, natureza, status from reuniao where id = $1', [v.atividadeId]);
        if (!r || r.natureza !== natureza) e.push('Atividade não encontrada para o tipo informado.');
        else if (r.status === 'cancelada') e.push('Atividade cancelada.');
        else {
          vinculo = await tx.consultaUm(
            `select id, instituicao_id, cargo from vinculo
              where pessoa_id = $1 and data_inicio <= $2 and (data_fim is null or data_fim >= $2)
              order by (status = 'ativo') desc, data_inicio desc limit 1`, [v.pessoaId, r.data]);
          if (!vinculo) e.push('A pessoa não tinha vínculo na data da atividade.');
          else if (v.instituicaoId && vinculo.instituicao_id !== v.instituicaoId) e.push('Instituição diferente do vínculo da pessoa na data.');
        }
      }
      const chave = `${v.atividadeId}|${v.pessoaId}`;
      let dup = vistos.has(chave);
      vistos.add(chave);
      if (!dup && !e.length) {
        dup = !!(await tx.consultaUm('select 1 from presenca where reuniao_id = $1 and pessoa_id = $2', [v.atividadeId, v.pessoaId]));
      }
      if (dup) { duplicados += 1; e.push('Duplicada: presença já está no arquivo ou no sistema.'); }
      if (e.length) erros.push({ linha, mensagem: e.join(' ') });
      else {
        validas.push({
          reuniaoId: v.atividadeId, pessoaId: v.pessoaId, vinculoId: vinculo.id, instituicaoId: vinculo.instituicao_id,
          cargo: vinculo.cargo, status, modo: status === 'presente' ? (v.modalidade || 'presencial') : null,
          horario: status === 'presente' ? horario : null, justificativa: v.justificativa,
        });
      }
    }
  }
  return { validas, erros, duplicados };
}

/**
 * @param {Usuario|null} usuario
 * @param {string} tipo
 * @param {{ nome: string, conteudo: Buffer }|null} arquivo
 */
export async function validarImportacao(usuario, tipo, arquivo) {
  const u = soAdmin(usuario);
  if (!(tipo in COLUNAS)) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Tipo de importação: instituicoes ou presencas.',
      { campos: [{ campo: 'tipo', mensagem: 'Selecione o tipo.' }] });
  }
  if (!arquivo?.conteudo?.length) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Selecione o arquivo CSV.', { campos: [{ campo: 'arquivo', mensagem: 'Selecione o arquivo.' }] });
  }
  if (arquivo.conteudo.length > LIMITE_IMPORTACAO_BYTES) {
    throw new ErroDeNegocio('ARQUIVO_GRANDE_DEMAIS', 'O CSV passa de 5 MB.', { limiteBytes: LIMITE_IMPORTACAO_BYTES });
  }
  const { colunas, linhas } = interpretar(arquivo.conteudo, tipo);
  const hash = createHash('sha256').update(arquivo.conteudo).digest('hex');

  return comUsuario(u.id, async (tx) => {
    const { validas, erros, duplicados } = await conferir(tx, tipo, linhas);
    const resumo = {
      total: linhas.length,
      validos: validas.length,
      duplicados,
      erros,
      colunas,
      amostra: linhas.slice(0, 5).map((l) => l.v),
    };
    const p = await tx.consultaUm(
      `insert into importacao_previa (usuario_id, tipo, hash_arquivo, nome_arquivo, linhas, resumo)
       values ($1, $2, $3, $4, $5, $6) returning id, expira_em`,
      [u.id, tipo, hash, arquivo.nome?.slice(0, 200) ?? null, JSON.stringify(linhas), JSON.stringify(resumo)]);
    return {
      previa: {
        id: p.id, ...resumo, erros: erros.slice(0, 500), expiraEm: isoComFuso(p.expira_em),
        podeConfirmar: !erros.length && !duplicados && validas.length > 0,
      },
    };
  });
}

/**
 * @param {Usuario|null} usuario
 * @param {unknown} corpo
 */
export async function confirmarImportacao(usuario, corpo) {
  const u = soAdmin(usuario);
  const previaId = /** @type {any} */ (corpo)?.previaId;
  if (!previaId || !UUID.test(String(previaId))) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe a prévia validada.', { campos: [{ campo: 'previaId', mensagem: 'Prévia inválida.' }] });
  }

  return comUsuario(u.id, async (tx) => {
    // RLS: prévia de outra conta nem aparece. "for update": duas confirmações
    // simultâneas da mesma prévia esperam uma pela outra.
    const p = await tx.consultaUm('select * from importacao_previa where id = $1 for update', [previaId]);
    if (!p) throw new ErroDeNegocio('TRANSICAO_INVALIDA', 'Prévia não encontrada para esta conta. Valide o arquivo de novo.');
    if (p.confirmada_em) {
      const i = await tx.consultaUm('select id, status, importados from importacao where id = $1', [p.importacao_id]);
      return { importacao: { id: i.id, status: i.status, importados: i.importados }, repetida: true };
    }
    if (new Date(p.expira_em) <= new Date()) {
      throw new ErroDeNegocio('TRANSICAO_INVALIDA', 'A prévia venceu (30 minutos). Valide o arquivo de novo.');
    }

    // Revalida contra o banco de agora: algo pode ter mudado desde a prévia.
    const { validas, erros, duplicados } = await conferir(tx, p.tipo, p.linhas);
    if (erros.length || duplicados) {
      throw new ErroDeNegocio('TRANSICAO_INVALIDA',
        `O arquivo tem ${erros.length} linha(s) com erro ou duplicidade. Corrija e valide de novo.`,
        { erros: erros.slice(0, 100) });
    }
    if (!validas.length) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhuma linha para importar.');

    try {
      if (p.tipo === 'instituicoes') {
        for (const x of validas) {
          const i = await tx.consultaUm(
            `insert into instituicao (nome, nome_fantasia, razao_social, cnpj, email, telefone, vertente_id,
                                      data_entrada, status, created_by, updated_by)
             values ($1, $1, $2, $3, $4, $5, $6, $7, $8::status_instituicao, $9, $9) returning id`,
            [x.nomeFantasia, x.razaoSocial, x.cnpj, x.email, x.telefone, x.vertenteId, x.dataIngresso,
              x.dataIngresso ? 'ativa' : 'rascunho', u.id]);
          if (x.gtIds.length) {
            await tx.consulta(
              `insert into instituicao_grupo_trabalho (instituicao_id, grupo_trabalho_id)
               select $1, unnest($2::smallint[]) on conflict do nothing`, [i.id, x.gtIds]);
          }
        }
      } else {
        for (const x of validas) {
          await tx.consulta(
            `insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id, cargo_no_momento, tipo,
                                   status, origem, horario_checkin, observacoes, registrado_por, modo)
             values ($1, $2, $3, $4, $5, 'representante', $6::status_presenca, 'importacao', $7, $8, $9, $10)`,
            [x.reuniaoId, x.pessoaId, x.vinculoId, x.instituicaoId, x.cargo, x.status, x.horario, x.justificativa, u.id, x.modo]);
        }
      }
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    const i = await tx.consultaUm(
      `insert into importacao (previa_id, usuario_id, tipo, importados, nome_arquivo)
       values ($1, $2, $3, $4, $5) returning id, status, importados`,
      [p.id, u.id, p.tipo, validas.length, p.nome_arquivo]);
    await tx.consulta('update importacao_previa set confirmada_em = now(), importacao_id = $2 where id = $1', [p.id, i.id]);
    return { importacao: { id: i.id, status: i.status, importados: i.importados } };
  });
}

/** @param {Usuario|null} usuario */
export async function listarImportacoes(usuario) {
  const u = soAdmin(usuario);
  return comUsuario(u.id, async (tx) => ({
    dados: (await tx.consulta(
      `select i.id, i.tipo, i.status, i.created_at, i.importados, i.nome_arquivo, a.nome as autor_nome
         from importacao i left join usuario a on a.id = i.usuario_id order by i.created_at desc`))
      .map((i) => ({
        id: i.id, tipo: i.tipo, status: i.status, criadaEm: isoComFuso(i.created_at),
        autorNome: i.autor_nome ?? null, importados: i.importados, arquivo: i.nome_arquivo,
      })),
  }));
}
