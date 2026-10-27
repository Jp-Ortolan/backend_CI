/**
 * Tradução entre a ficha de instituição do contrato /api/governanca (tela
 * "Cadastro no Fórum" e "Minha instituição" do front) e as colunas do banco.
 *
 * O front trabalha com campos de texto simples (GTs separados por vírgula,
 * endereço numa linha, redes sociais uma por linha). O banco guarda isso
 * estruturado. Aqui fica a conversão nos dois sentidos — e a validação, que é
 * a mesma quando o admin salva direto e quando a Diretoria aprova um pedido.
 */
import { ErroDeNegocio } from '@/dominio/erros.js';
import { pode } from '@/dominio/permissoes.js';
import { apenasDigitos, cnpjValido } from '@/dominio/cnpj.js';
import { TRANSICOES_INSTITUICAO } from '@/aplicacao/instituicoes/alterar-status-instituicao.js';
import { gravarGruposDaInstituicao } from '@/aplicacao/instituicoes/esquemas.js';
import { designarRepresentacao, resolverPessoa } from '@/aplicacao/vinculos/representacao.js';

/** @typedef {import('@/infraestrutura/banco/consulta.js').Transacao} Transacao */

/** Campo do contrato → rótulo da tela (o mesmo de institutionSchema no front). */
export const ROTULOS_INSTITUICAO = {
  nomeFantasia: 'Nome fantasia',
  razaoSocial: 'Razão social',
  cnpj: 'CNPJ',
  telefone: 'Telefone',
  email: 'E-mail institucional',
  endereco: 'Endereço completo',
  vertente: 'Vertente do ecossistema',
  gts: 'Grupos de trabalho',
  dataIngresso: 'Data de ingresso',
  situacaoAdesao: 'Situação da adesão',
  contatosComunicacao: 'Contatos de comunicação',
  redesSociais: 'Redes sociais',
  autorizaDivulgacao: 'Autoriza divulgação pública',
  titular: 'Titular',
  suplente: 'Suplente',
  motivoSaida: 'Motivo da saída',
  dataSaida: 'Data da saída',
};

export const CAMPOS_INSTITUICAO = Object.keys(ROTULOS_INSTITUICAO);

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const URL_HTTP = /^https?:\/\/\S+$/i;

/** Situação do banco → "situação da adesão" do contrato. */
export function situacaoAdesao(status) {
  return status === 'ativa' || status === 'em_processo_saida' ? 'aprovada' : status;
}
/** E de volta. */
const statusDoBanco = (s) => (s === 'aprovada' ? 'ativa' : s);

/** @param {any} i linha do banco */
function enderecoMontado(i) {
  if (i.endereco_texto) return i.endereco_texto;
  const rua = [i.logradouro, i.numero].filter(Boolean).join(', ');
  const cidade = [i.cidade, i.uf].filter(Boolean).join('/');
  const cep = i.cep ? `CEP ${String(i.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '';
  return [rua, i.bairro, cidade, cep, i.complemento].filter(Boolean).join(' - ') || '';
}

/** Redes do banco (objeto) → uma por linha. */
const redesEmTexto = (r) => Object.values(r ?? {}).filter(Boolean).join('\n');

/** Uma por linha (ou separadas por vírgula) → objeto pelo domínio. */
function redesDoTexto(texto) {
  const urls = String(texto ?? '').split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);
  /** @type {Record<string, string>} */
  const redes = {};
  for (const u of urls) {
    if (!URL_HTTP.test(u)) return { erro: `"${u}" não é um endereço completo (https://...).` };
    const chave = /instagram\./i.test(u) ? 'instagram' : /linkedin\./i.test(u) ? 'linkedin'
      : /facebook\.|fb\.com/i.test(u) ? 'facebook' : /youtube\.|youtu\.be/i.test(u) ? 'youtube'
        : /(^https?:\/\/(www\.)?(x|twitter)\.com)/i.test(u) ? 'x' : 'outro';
    redes[redes[chave] ? `${chave}_${Object.keys(redes).length}` : chave] = u;
  }
  return { redes };
}

/** Contatos do banco → uma linha por contato ("Nome · e-mail · telefone · função"). */
const contatosEmTexto = (lista) => (Array.isArray(lista) ? lista : [])
  .map((c) => [c.nome, c.email, c.telefone, c.funcao].filter(Boolean).join(' · ')).join('\n');

/** Uma linha por contato → lista. Reconhece e-mail e telefone em cada linha. */
function contatosDoTexto(texto) {
  return String(texto ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10).map((linha) => {
    const partes = linha.split(/\s*[·|;]\s*/).filter(Boolean);
    const email = partes.find((p) => /^\S+@\S+\.\S+$/.test(p)) ?? null;
    const telefone = partes.find((p) => /^[\d()+\s-]{8,}$/.test(p)) ?? null;
    const resto = partes.filter((p) => p !== email && p !== telefone);
    return { nome: resto[0] ?? linha, email, telefone, funcao: resto[1] ?? null };
  });
}

/**
 * A ficha no formato do contrato.
 *
 * @param {Transacao} tx
 * @param {string} id
 */
export async function lerRegistroInstituicao(tx, id) {
  const i = await tx.consultaUm(
    `select i.*, ve.nome as vertente_nome,
            coalesce((select string_agg(g.nome, ', ' order by g.nome)
                        from instituicao_grupo_trabalho ig
                        join grupo_trabalho g on g.id = ig.grupo_trabalho_id
                       where ig.instituicao_id = i.id), '') as gts,
            (select p.nome from vinculo v join pessoa p on p.id = v.pessoa_id
              where v.instituicao_id = i.id and v.status = 'ativo'
                and v.tipo_representacao = 'titular' limit 1) as titular,
            (select p.nome from vinculo v join pessoa p on p.id = v.pessoa_id
              where v.instituicao_id = i.id and v.status = 'ativo'
                and v.tipo_representacao = 'suplente' limit 1) as suplente
       from instituicao i
       left join vertente ve on ve.id = i.vertente_id
      where i.id = $1`,
    [id]);
  if (!i) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

  return {
    id: i.id,
    nomeFantasia: i.nome_fantasia ?? i.nome,
    razaoSocial: i.razao_social ?? '',
    cnpj: i.cnpj ?? '',
    telefone: i.telefone ?? '',
    email: i.email ?? '',
    endereco: enderecoMontado(i),
    vertente: i.vertente_nome ?? '',
    gts: i.gts,
    dataIngresso: i.data_entrada ?? '',
    situacaoAdesao: situacaoAdesao(i.status),
    contatosComunicacao: contatosEmTexto(i.contatos_comunicacao),
    redesSociais: redesEmTexto(i.redes_sociais),
    autorizaDivulgacao: !!i.autoriza_divulgacao,
    titular: i.titular ?? '',
    suplente: i.suplente ?? '',
    motivoSaida: i.motivo_saida ?? '',
    dataSaida: i.data_saida ?? '',
    versaoRegistro: Number(i.versao_registro),
  };
}

/**
 * Quais campos o pedido muda de verdade, com antes e depois — o quadro que a
 * Diretoria vê para decidir.
 *
 * @param {Record<string, any>} atual
 * @param {Record<string, any>} campos
 */
export function compararInstituicao(atual, campos) {
  return Object.entries(campos)
    .filter(([k, v]) => k in ROTULOS_INSTITUICAO && String(v ?? '') !== String(atual[k] ?? ''))
    .map(([k, v]) => ({ campo: k, rotulo: ROTULOS_INSTITUICAO[/** @type {keyof typeof ROTULOS_INSTITUICAO} */ (k)], antes: atual[k] ?? null, depois: v }));
}

/**
 * Valida os campos da ficha sem gravar nada (só leituras). Serve para recusar
 * um pedido de alteração já na entrada, e não só na hora de aprovar.
 *
 * @param {Transacao} tx
 * @param {string} id
 * @param {Record<string, any>} campos
 * @param {{ id: string, papel: string }} quem
 * @param {{ conferirPermissao?: boolean }} [opcoes]
 */
export async function prepararRegistroInstituicao(tx, id, campos, quem, opcoes = {}) {
  const conferirPermissao = opcoes.conferirPermissao ?? true;
  const atualLinha = await tx.consultaUm(
    'select id, status, data_entrada, data_saida, motivo_saida from instituicao where id = $1', [id]);
  if (!atualLinha) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

  const desconhecidos = Object.keys(campos).filter((k) => !CAMPOS_INSTITUICAO.includes(k));
  if (desconhecidos.length) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Há campos que não existem na ficha da instituição.',
      { campos: desconhecidos.map((c) => ({ campo: c, mensagem: 'Campo desconhecido.' })) });
  }

  /** @type {{ campo: string, mensagem: string }[]} */
  const erros = [];
  /** @type {Record<string, unknown>} */
  const col = {};
  const texto = (/** @type {unknown} */ v) => (v === null || v === undefined ? '' : String(v).trim());

  if ('nomeFantasia' in campos) {
    const v = texto(campos.nomeFantasia);
    if (v.length < 3) erros.push({ campo: 'nomeFantasia', mensagem: 'Informe o nome (ao menos 3 letras).' });
    else { col.nome_fantasia = v; col.nome = v; }
  }
  if ('razaoSocial' in campos) col.razao_social = texto(campos.razaoSocial) || null;
  if ('cnpj' in campos) {
    const v = apenasDigitos(texto(campos.cnpj));
    if (v && !cnpjValido(v)) erros.push({ campo: 'cnpj', mensagem: 'CNPJ inválido. Confira os números.' });
    else col.cnpj = v || null;
  }
  if ('telefone' in campos) {
    const v = texto(campos.telefone);
    if (v.length > 20) erros.push({ campo: 'telefone', mensagem: 'Telefone longo demais.' });
    else col.telefone = v || null;
  }
  if ('email' in campos) {
    const v = texto(campos.email).toLowerCase();
    if (v && !/^\S+@\S+\.\S+$/.test(v)) erros.push({ campo: 'email', mensagem: 'E-mail inválido.' });
    else col.email = v || null;
  }
  if ('endereco' in campos) {
    const v = texto(campos.endereco);
    if (v.length > 300) erros.push({ campo: 'endereco', mensagem: 'Endereço longo demais (até 300 caracteres).' });
    else col.endereco_texto = v || null;
  }
  if ('vertente' in campos) {
    const v = texto(campos.vertente);
    if (!v) col.vertente_id = null;
    else {
      const ve = await tx.consultaUm(
        `select id from vertente where ativo and imutavel_unaccent(lower(nome)) = imutavel_unaccent(lower($1))`, [v]);
      if (!ve) {
        const opcoes = (await tx.consulta('select nome from vertente where ativo order by nome')).map((x) => x.nome);
        erros.push({ campo: 'vertente', mensagem: opcoes.length
          ? `Vertente não cadastrada. Use: ${opcoes.join(', ')}.`
          : 'Nenhuma vertente cadastrada ainda. A Diretoria cadastra em Domínios.' });
      } else col.vertente_id = ve.id;
    }
  }
  /** @type {number[]|null} */
  let gts = null;
  if ('gts' in campos) {
    const nomes = (Array.isArray(campos.gts) ? campos.gts : texto(campos.gts).split(','))
      .map((n) => String(n).trim()).filter(Boolean);
    gts = [];
    for (const n of nomes) {
      const g = await tx.consultaUm(
        `select id from grupo_trabalho where ativo and imutavel_unaccent(lower(nome)) = imutavel_unaccent(lower($1))`, [n]);
      if (!g) erros.push({ campo: 'gts', mensagem: `GT "${n}" não cadastrado.` });
      else gts.push(Number(g.id));
    }
  }
  if ('dataIngresso' in campos) {
    const v = texto(campos.dataIngresso);
    if (v && !DATA.test(v)) erros.push({ campo: 'dataIngresso', mensagem: 'Data inválida (AAAA-MM-DD).' });
    else col.data_entrada = v || null;
  }
  if ('contatosComunicacao' in campos) col.contatos_comunicacao = JSON.stringify(contatosDoTexto(campos.contatosComunicacao));
  if ('redesSociais' in campos) {
    const r = redesDoTexto(campos.redesSociais);
    if (r.erro) erros.push({ campo: 'redesSociais', mensagem: r.erro });
    else col.redes_sociais = JSON.stringify(r.redes);
  }
  if ('autorizaDivulgacao' in campos) {
    // "Autoriza divulgação pública da instituição e da logo": uma marcação só
    // na tela, as duas autorizações no banco.
    col.autoriza_divulgacao = campos.autorizaDivulgacao === true || campos.autorizaDivulgacao === 'true';
    col.autoriza_logo = col.autoriza_divulgacao;
  }
  if ('motivoSaida' in campos) col.motivo_saida = texto(campos.motivoSaida) || null;
  if ('dataSaida' in campos) {
    const v = texto(campos.dataSaida);
    if (v && !DATA.test(v)) erros.push({ campo: 'dataSaida', mensagem: 'Data inválida (AAAA-MM-DD).' });
    else col.data_saida = v || null;
  }

  // ------------------------------------------------------------- situação
  if ('situacaoAdesao' in campos && texto(campos.situacaoAdesao)) {
    const pedido = statusDoBanco(texto(campos.situacaoAdesao));
    const atual = atualLinha.status;
    const mesma = pedido === atual || (pedido === 'ativa' && atual === 'em_processo_saida');
    if (!mesma) {
      const permitidas = TRANSICOES_INSTITUICAO[/** @type {keyof typeof TRANSICOES_INSTITUICAO} */ (atual)] ?? [];
      if (!permitidas.includes(pedido)) {
        erros.push({ campo: 'situacaoAdesao',
          mensagem: `Não é possível ir de "${situacaoAdesao(atual)}" para "${campos.situacaoAdesao}".` });
      } else if (conferirPermissao && pedido === 'ativa'
        && !pode(/** @type {any} */ (quem.papel), 'instituicao', 'aprovar')) {
        erros.push({ campo: 'situacaoAdesao', mensagem: 'Seu perfil não aprova a entrada de instituições.' });
      } else {
        col.status = pedido;
        const hojeIso = new Date().toISOString().slice(0, 10);
        if (pedido === 'ativa') {
          col.data_saida = null;
          if (!atualLinha.data_entrada && !col.data_entrada) col.data_entrada = hojeIso;
        }
        if (['inativa', 'desligada'].includes(pedido) && !col.data_saida && !atualLinha.data_saida) {
          col.data_saida = hojeIso;
        }
        if (pedido === 'desligada' && !col.motivo_saida && !atualLinha.motivo_saida) {
          erros.push({ campo: 'motivoSaida', mensagem: 'Informe o motivo do desligamento.' });
        }
      }
    }
  }

  return { col, gts, erros };
}

/**
 * Valida e grava os campos da ficha. É o mesmo caminho para o admin salvando
 * direto e para a aprovação de "alteração cadastral".
 *
 * @param {Transacao} tx
 * @param {string} id
 * @param {Record<string, any>} campos  só os que mudam
 * @param {{ id: string, papel: string }} quem  quem aplica (vai para updated_by e auditoria)
 * @returns {Promise<string[]>} os campos aplicados
 */
export async function aplicarRegistroInstituicao(tx, id, campos, quem) {
  const { col, gts, erros } = await prepararRegistroInstituicao(tx, id, campos, quem);
  if (erros.length) throw new ErroDeNegocio('DADOS_INVALIDOS', erros[0].mensagem, { campos: erros });
  const texto = (/** @type {unknown} */ v) => (v === null || v === undefined ? '' : String(v).trim());

  if (Object.keys(col).length) {
    col.updated_by = quem.id;
    const nomes = Object.keys(col);
    await tx.consulta(
      `update instituicao set ${nomes.map((c, n) => `${c} = $${n + 2}${c === 'status' ? '::status_instituicao' : ''}`).join(', ')}
        where id = $1`,
      [id, ...Object.values(col)]);
  }
  if (gts) await gravarGruposDaInstituicao(tx, id, gts);

  // Titular e suplente pelo NOME: pessoa da própria instituição com esse nome,
  // ou uma pessoa nova. O vínculo do anterior é encerrado.
  for (const alvo of /** @type {const} */ (['titular', 'suplente'])) {
    if (!(alvo in campos)) continue;
    const nome = texto(campos[alvo]);
    const atual = await tx.consultaUm(
      `select p.nome from vinculo v join pessoa p on p.id = v.pessoa_id
        where v.instituicao_id = $1 and v.status = 'ativo' and v.tipo_representacao = $2::tipo_representacao`,
      [id, alvo]);
    if (!nome || nome === (atual?.nome ?? '')) continue;
    const pessoaId = await resolverPessoa(tx, id, { pessoa: { nome } });
    await designarRepresentacao(tx, id, {
      alvo, pessoaId, motivo: `Substituído como ${alvo} (alteração cadastral aprovada)`,
    });
  }

  return Object.keys(campos);
}
