-- =============================================================================
-- 003 — Núcleo cadastral: tipo_instituicao, instituicao, pessoa, vinculo
-- =============================================================================

create table tipo_instituicao (
  id        smallserial primary key,
  nome      text not null unique,
  descricao text
);

create table instituicao (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null,
  nome_busca           text generated always as (imutavel_unaccent(lower(nome))) stored,
  cnpj                 char(14) unique,
  tipo_instituicao_id  smallint references tipo_instituicao(id) on delete set null,
  cidade               text,
  uf                   char(2),
  email                text,
  telefone             text,
  site                 text,
  responsavel          text,
  status               status_instituicao not null default 'em_processo_entrada',
  data_entrada         date,
  data_saida           date,
  observacoes          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references usuario(id),
  updated_by           uuid references usuario(id),
  constraint instituicao_saida_apos_entrada
    check (data_saida is null or data_entrada is null or data_saida >= data_entrada),
  constraint instituicao_inativa_tem_saida
    check (status <> 'inativa' or data_saida is not null),
  constraint instituicao_cnpj_digitos
    check (cnpj is null or cnpj ~ '^[0-9]{14}$')
);
create index instituicao_status_idx on instituicao (status);
create index instituicao_nome_trgm  on instituicao using gin (nome_busca gin_trgm_ops);

create table instituicao_status_historico (
  id               bigserial primary key,
  instituicao_id   uuid not null references instituicao(id) on delete cascade,
  status_anterior  status_instituicao,
  status_novo      status_instituicao not null,
  motivo           text,
  alterado_em      timestamptz not null default now(),
  alterado_por     uuid references usuario(id)
);
create index inst_hist_idx on instituicao_status_historico (instituicao_id, alterado_em desc);

-- DECISÃO CENTRAL: "representante" não é entidade, é o vínculo entre pessoa e
-- instituição. A pessoa existe sozinha e pode trocar de instituição sem que o
-- histórico anterior se perca.
create table pessoa (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  nome_busca   text generated always as (imutavel_unaccent(lower(nome))) stored,
  email        text unique,
  telefone     text,
  observacoes  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index pessoa_nome_trgm on pessoa using gin (nome_busca gin_trgm_ops);

create table vinculo (
  id              uuid primary key default gen_random_uuid(),
  pessoa_id       uuid not null references pessoa(id) on delete cascade,
  instituicao_id  uuid not null references instituicao(id) on delete restrict,
  cargo           text,
  status          status_vinculo not null default 'ativo',
  data_inicio     date not null default current_date,
  data_fim        date,
  observacoes     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vinculo_fim_apos_inicio
    check (data_fim is null or data_fim >= data_inicio),
  constraint vinculo_encerrado_tem_fim
    check (status <> 'encerrado' or data_fim is not null)
);
create unique index vinculo_ativo_unico
  on vinculo (pessoa_id, instituicao_id) where status = 'ativo';
create index vinculo_instituicao_idx on vinculo (instituicao_id) where status = 'ativo';
create index vinculo_pessoa_idx      on vinculo (pessoa_id);

comment on table vinculo is
  'Relação pessoa <-> instituição com período. Encerrar NUNCA apaga a linha: '
  'apenas marca status=encerrado e preenche data_fim.';
