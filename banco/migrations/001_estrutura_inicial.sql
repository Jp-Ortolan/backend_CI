-- =============================================================================
-- 001 — Estrutura inicial do banco  ·  Semana 2
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- Esta é a ÚNICA migration do projeto: aplicá-la num PostgreSQL vazio deixa o
-- banco inteiro de pé — tabelas, regras, índices, views, controle de acesso e
-- as funções de login e de check-in.
--
-- Roda em qualquer PostgreSQL 15+. Não depende de extensão proprietária nem de
-- schema de plataforma: o banco local, o de homologação e o de produção são o
-- mesmo produto.
--
-- ORDEM DAS PARTES (a ordem importa: cada parte usa o que a anterior criou)
--   1. Extensões e tipos
--   2. Usuários, sessões e recuperação de senha
--   3. Núcleo cadastral: tipo_instituicao, instituicao, pessoa, vinculo
--   4. Operação: reuniao, presenca, documento
--   5. Triggers de auditoria e histórico
--   6. Views de consolidação (RF41 a RF48)
--   7. Controle de acesso no banco (RF03, RNF15)
--   8. Funções de autenticação
--   9. Check-in público por QR Code (RF26 a RF34)
--   10. Carga inicial (dados de domínio, não de teste)
--
-- COMO APLICAR
--   ./scripts/migrar.sh          aplica só o que ainda não rodou
--   ./scripts/resetar.sh         apaga tudo e recria (somente banco local)
--
-- COMO ALTERAR O BANCO DAQUI PARA A FRENTE
--   Não edite este arquivo depois que ele já rodou em algum banco: crie
--   banco/migrations/002_descricao_curta.sql com apenas a mudança nova.
--   Migration aplicada é história — reescrever história quebra o banco de quem
--   já aplicou.
-- =============================================================================

-- =============================================================================
-- PARTE 1 — Extensões e tipos
-- Sistema de Gestão do Ecossistema de Inovação · PostgreSQL 15+ (Railway)
--
-- Este conjunto de migrations roda em QUALQUER PostgreSQL. Não depende de
-- extensão proprietária nem de schema de plataforma — o banco local, o de
-- homologação e o de produção são o mesmo produto.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid(), gen_random_bytes()
create extension if not exists unaccent;   -- busca ignorando acento
create extension if not exists pg_trgm;    -- busca aproximada por nome (check-in)

-- unaccent() não é IMMUTABLE e por isso não pode ir direto numa coluna gerada.
create or replace function imutavel_unaccent(text)
  returns text language sql immutable strict parallel safe
as $$ select unaccent('unaccent', $1) $$;

create type status_instituicao as enum
  ('em_processo_entrada', 'ativa', 'em_processo_saida', 'inativa');
create type status_vinculo    as enum ('ativo', 'encerrado');
create type status_reuniao    as enum ('agendada', 'em_andamento', 'encerrada', 'cancelada');
create type tipo_participante as enum ('representante', 'convidado');
create type status_presenca   as enum ('presente', 'ausente', 'justificado');
create type origem_presenca   as enum ('qrcode', 'manual', 'importacao');
create type papel_usuario     as enum ('admin', 'gestor', 'leitura');

-- =============================================================================
-- ↓↓↓  PARTE 2 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 2 — Usuários, sessões e recuperação de senha
--
-- Antes isto vinha pronto da plataforma. Agora é nosso, e por isso está
-- explícito: a senha nunca é guardada, só o hash Argon2id; a sessão é uma linha
-- com validade; o token de recuperação também é guardado como hash, para que
-- vazar o banco não permita assumir contas.
-- =============================================================================

create table usuario (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  email        text not null unique,
  senha_hash   text,                       -- nulo = acesso criado, senha ainda não definida
  papel        papel_usuario not null default 'leitura',
  ativo        boolean not null default true,
  ultimo_login timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint usuario_email_minusculo check (email = lower(email))
);

comment on table usuario is
  'Quem administra o sistema. Participante de reunião NÃO é usuário — ele existe em pessoa.';
comment on column usuario.senha_hash is
  'Hash Argon2id. Nunca guardar a senha em texto puro nem hash reversível.';

-- ------------------------------------------------------------------- sessões
-- Guardamos o HASH do token, não o token. O cookie do navegador tem o valor
-- original; se alguém ler esta tabela, não consegue montar um cookie válido.
create table sessao (
  token_hash  text primary key,
  usuario_id  uuid not null references usuario(id) on delete cascade,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  ip          text,
  agente      text,
  constraint sessao_expira_depois check (expira_em > criada_em)
);

create index sessao_usuario_idx on sessao (usuario_id);
create index sessao_expira_idx  on sessao (expira_em);

-- ------------------------------------------- token de recuperação de senha
create table token_recuperacao (
  token_hash  text primary key,
  usuario_id  uuid not null references usuario(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  constraint token_expira_depois check (expira_em > criado_em)
);

create index token_recuperacao_usuario_idx on token_recuperacao (usuario_id);

-- Limpeza de sessões e tokens vencidos. Chamada pela aplicação de vez em
-- quando; não depende de agendador para o sistema funcionar.
create or replace function limpar_expirados() returns table (sessoes int, tokens int)
language plpgsql as $$
declare s int; t int;
begin
  delete from sessao where expira_em < now();
  get diagnostics s = row_count;
  delete from token_recuperacao where expira_em < now() or usado_em is not null;
  get diagnostics t = row_count;
  return query select s, t;
end $$;

-- =============================================================================
-- ↓↓↓  PARTE 3 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 3 — Núcleo cadastral: tipo_instituicao, instituicao, pessoa, vinculo
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

-- =============================================================================
-- ↓↓↓  PARTE 4 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 4 — Operação: reuniao, presenca, documento
-- =============================================================================

create table reuniao (
  id                uuid primary key default gen_random_uuid(),
  titulo            text not null,
  data              date not null,
  hora_inicio       time,
  hora_fim          time,
  local             text,
  descricao         text,
  pauta             text,
  status            status_reuniao not null default 'agendada',
  -- O QR aponta para /checkin/<qr_token>. Token aleatório, não o id da reunião:
  -- evita que alguém adivinhe a URL de outra reunião.
  qr_token          text not null unique default encode(gen_random_bytes(16), 'hex'),
  checkin_abre_em   timestamptz,
  checkin_fecha_em  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references usuario(id),
  constraint reuniao_horario_coerente
    check (hora_fim is null or hora_inicio is null or hora_fim > hora_inicio),
  constraint reuniao_janela_checkin_coerente
    check (checkin_fecha_em is null or checkin_abre_em is null or checkin_fecha_em > checkin_abre_em)
);
create index reuniao_data_idx   on reuniao (data desc);
create index reuniao_status_idx on reuniao (status);

-- presenca guarda SNAPSHOT do vínculo no momento do check-in. Sem isso, trocar
-- de instituição reescreveria o histórico das reuniões passadas.
create table presenca (
  id                    uuid primary key default gen_random_uuid(),
  reuniao_id            uuid not null references reuniao(id) on delete cascade,
  pessoa_id             uuid references pessoa(id) on delete set null,
  vinculo_id            uuid references vinculo(id) on delete set null,
  instituicao_id        uuid references instituicao(id) on delete set null,
  cargo_no_momento      text,
  tipo                  tipo_participante not null default 'representante',
  status                status_presenca   not null default 'presente',
  origem                origem_presenca   not null default 'qrcode',
  horario_checkin       timestamptz,
  nome_informado        text,
  email_informado       text,
  instituicao_informada text,
  observacoes           text,
  registrado_por        uuid references usuario(id),
  created_at            timestamptz not null default now(),
  constraint presenca_pessoa_unica unique (reuniao_id, pessoa_id),
  -- Convidado nunca carrega vínculo oficial (RF33).
  constraint presenca_convidado_sem_vinculo check (
       (tipo = 'representante' and pessoa_id is not null)
    or (tipo = 'convidado'     and vinculo_id is null and nome_informado is not null)
  ),
  constraint presenca_presente_tem_horario
    check (status <> 'presente' or horario_checkin is not null)
);
create index presenca_reuniao_idx     on presenca (reuniao_id);
create index presenca_pessoa_idx      on presenca (pessoa_id);
create index presenca_instituicao_idx on presenca (instituicao_id);

create table documento (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  descricao       text,
  tipo            text,
  storage_path    text not null unique,
  mime_type       text,
  tamanho_bytes   bigint,
  instituicao_id  uuid references instituicao(id) on delete cascade,
  reuniao_id      uuid references reuniao(id)     on delete cascade,
  enviado_por     uuid references usuario(id),
  created_at      timestamptz not null default now(),
  constraint documento_tem_dono
    check (instituicao_id is not null or reuniao_id is not null)
);
create index documento_instituicao_idx on documento (instituicao_id);
create index documento_reuniao_idx     on documento (reuniao_id);

-- =============================================================================
-- ↓↓↓  PARTE 5 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 5 — Triggers de auditoria e histórico
-- =============================================================================

create or replace function tg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger usuario_touch     before update on usuario
  for each row execute function tg_touch_updated_at();
create trigger instituicao_touch before update on instituicao
  for each row execute function tg_touch_updated_at();
create trigger pessoa_touch      before update on pessoa
  for each row execute function tg_touch_updated_at();
create trigger vinculo_touch     before update on vinculo
  for each row execute function tg_touch_updated_at();
create trigger reuniao_touch     before update on reuniao
  for each row execute function tg_touch_updated_at();

-- Toda troca de status vira linha no histórico sem a aplicação precisar lembrar.
create or replace function tg_registra_status_instituicao() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into instituicao_status_historico
      (instituicao_id, status_anterior, status_novo, alterado_por)
    values (new.id,
            case when tg_op = 'INSERT' then null else old.status end,
            new.status,
            new.updated_by);
  end if;
  return new;
end $$;

create trigger instituicao_status_hist after insert or update on instituicao
  for each row execute function tg_registra_status_instituicao();

-- =============================================================================
-- ↓↓↓  PARTE 6 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 6 — Views de consolidação (RF41 a RF48)
-- Nenhum indicador é gravado em coluna: todos derivam dos registros de presença.
-- =============================================================================

-- Quais reuniões CADA VÍNCULO deveria ter participado. Só conta reunião ocorrida
-- dentro do período de vigência do vínculo (RF44).
create view vw_reuniao_esperada as
select v.id as vinculo_id, v.pessoa_id, v.instituicao_id,
       r.id as reuniao_id, r.data as reuniao_data
from vinculo v
join reuniao r
  on r.status = 'encerrada'
 and r.data >= v.data_inicio
 and (v.data_fim is null or r.data <= v.data_fim);

create view vw_participacao_representante as
select p.id as pessoa_id, p.nome as representante,
       i.id as instituicao_id, i.nome as instituicao,
       count(distinct e.reuniao_id) as reunioes_esperadas,
       count(distinct pr.reuniao_id) filter (where pr.status = 'presente') as presencas,
       count(distinct e.reuniao_id)
         - count(distinct pr.reuniao_id) filter (where pr.status = 'presente') as ausencias,
       round(100.0 * count(distinct pr.reuniao_id) filter (where pr.status = 'presente')
             / nullif(count(distinct e.reuniao_id), 0), 1) as percentual_participacao,
       max(pr.horario_checkin) as ultima_participacao
from pessoa p
join vinculo v     on v.pessoa_id = p.id
join instituicao i on i.id = v.instituicao_id
left join vw_reuniao_esperada e on e.vinculo_id = v.id
left join presenca pr on pr.pessoa_id = p.id and pr.reuniao_id = e.reuniao_id
group by p.id, p.nome, i.id, i.nome;

create view vw_participacao_instituicao as
select i.id as instituicao_id, i.nome as instituicao, i.status,
       count(distinct v.id) filter (where v.status = 'ativo') as representantes_ativos,
       count(distinct e.reuniao_id) as reunioes_esperadas,
       count(distinct pr.reuniao_id) filter (where pr.status = 'presente') as reunioes_com_presenca,
       round(100.0 * count(distinct pr.reuniao_id) filter (where pr.status = 'presente')
             / nullif(count(distinct e.reuniao_id), 0), 1) as percentual_participacao
from instituicao i
left join vinculo v on v.instituicao_id = i.id
left join vw_reuniao_esperada e on e.vinculo_id = v.id
left join presenca pr on pr.instituicao_id = i.id and pr.reuniao_id = e.reuniao_id
group by i.id, i.nome, i.status;

create view vw_resumo_reuniao as
select r.id as reuniao_id, r.titulo, r.data, r.status,
       count(pr.id) as total_registros,
       count(pr.id) filter (where pr.status = 'presente')  as presentes,
       count(pr.id) filter (where pr.status = 'ausente')   as ausentes,
       count(pr.id) filter (where pr.tipo   = 'convidado') as convidados,
       count(distinct pr.instituicao_id) as instituicoes_presentes,
       round(100.0 * count(pr.id) filter (where pr.status = 'presente')
             / nullif(count(pr.id), 0), 1) as percentual_presenca
from reuniao r
left join presenca pr on pr.reuniao_id = r.id
group by r.id, r.titulo, r.data, r.status;

create view vw_dashboard as
select
  (select count(*) from instituicao where status = 'ativa')   as instituicoes_ativas,
  (select count(*) from instituicao where status = 'inativa') as instituicoes_inativas,
  (select count(*) from instituicao
     where status in ('em_processo_entrada','em_processo_saida')) as instituicoes_em_processo,
  (select count(*) from vinculo where status = 'ativo')       as representantes_ativos,
  (select count(*) from reuniao where status = 'encerrada')    as reunioes_realizadas,
  (select round(avg(percentual_presenca), 1)
     from vw_resumo_reuniao where status = 'encerrada')        as media_presenca;

-- =============================================================================
-- ↓↓↓  PARTE 7 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 7 — Controle de acesso no banco (RF03, RNF15)
--
-- COMO FUNCIONA
-- A aplicação abre uma transação e declara quem é o usuário:
--     select set_config('app.usuario_id', '<uuid>', true);
-- O "true" no fim faz o valor valer só dentro daquela transação — duas
-- requisições simultâneas não se enxergam.
--
-- POR QUE EXISTE UM PAPEL SEPARADO
-- No PostgreSQL, o DONO das tabelas ignora RLS por padrão. Se a aplicação
-- conectasse como o usuário administrador do banco, todas as políticas abaixo
-- seriam decorativas. Por isso a aplicação conecta como "app_web", que não é
-- dono de nada — e aí o RLS vale de verdade.
--
-- As migrations e os seeds continuam rodando como dono, e por isso funcionam
-- sem precisar declarar usuário.
-- =============================================================================

-- ------------------------------------------------------- quem é o usuário
create or replace function usuario_atual_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

create or replace function papel_atual() returns papel_usuario
language sql stable security definer set search_path = public as $$
  select papel from usuario where id = usuario_atual_id() and ativo
$$;

comment on function papel_atual() is
  'Papel do usuário da transação atual. Espelha a matriz de '
  'lib/dominio/permissoes.ts — mudou lá, muda aqui.';

-- ----------------------------------------------------- papel da aplicação
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_web') then
    -- Sem senha e sem LOGIN por enquanto: quem define a senha é o time de
    -- DevOps, com um comando único, para a senha não ficar no repositório.
    create role app_web nologin;
  end if;
end $$;

grant usage on schema public to app_web;
grant select, insert, update, delete on all tables in schema public to app_web;
grant usage, select on all sequences in schema public to app_web;
grant execute on all functions in schema public to app_web;

-- tabelas criadas depois desta migration já nascem com a permissão
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_web;
alter default privileges in schema public
  grant usage, select on sequences to app_web;

-- --------------------------------------------------------------- políticas
alter table usuario                      enable row level security;
alter table sessao                       enable row level security;
alter table token_recuperacao            enable row level security;
alter table tipo_instituicao             enable row level security;
alter table instituicao                  enable row level security;
alter table instituicao_status_historico enable row level security;
alter table pessoa                       enable row level security;
alter table vinculo                      enable row level security;
alter table reuniao                      enable row level security;
alter table presenca                     enable row level security;
alter table documento                    enable row level security;

-- Dados do ecossistema: todo usuário autenticado lê; admin e gestor escrevem;
-- só admin exclui — apagar instituição ou vínculo levaria o histórico junto.
do $$
declare t text;
begin
  foreach t in array array['tipo_instituicao','instituicao','instituicao_status_historico',
                           'pessoa','vinculo','reuniao','presenca','documento']
  loop
    execute format(
      'create policy %I_ler on %I for select
         using (usuario_atual_id() is not null)', t, t);
    execute format(
      'create policy %I_inserir on %I for insert
         with check (papel_atual() in (''admin'',''gestor''))', t, t);
    execute format(
      'create policy %I_atualizar on %I for update
         using (papel_atual() in (''admin'',''gestor''))
         with check (papel_atual() in (''admin'',''gestor''))', t, t);
    execute format(
      'create policy %I_excluir on %I for delete
         using (papel_atual() = ''admin'')', t, t);
  end loop;
end $$;

-- usuario: cada um lê o próprio registro; só admin administra a tabela.
create policy usuario_ler_proprio on usuario
  for select using (id = usuario_atual_id() or papel_atual() = 'admin');
create policy usuario_admin_inserir on usuario
  for insert with check (papel_atual() = 'admin');
create policy usuario_admin_atualizar on usuario
  for update using (papel_atual() = 'admin' or id = usuario_atual_id())
              with check (papel_atual() = 'admin' or id = usuario_atual_id());
create policy usuario_admin_excluir on usuario
  for delete using (papel_atual() = 'admin');

-- sessao e token_recuperacao: manipulados por funções SECURITY DEFINER
-- durante o login, quando ainda não há usuário na transação. Nenhuma política
-- permissiva aqui — o acesso normal fica bloqueado de propósito.

-- =============================================================================
-- ↓↓↓  PARTE 8 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 8 — Funções de autenticação
--
-- As tabelas sessao e token_recuperacao ficam fechadas pelo RLS: durante o
-- login ainda não existe usuário declarado na transação, então não haveria como
-- uma política liberar o acesso sem abrir demais.
--
-- A saída é concentrar essas operações em funções SECURITY DEFINER — elas
-- rodam com o privilégio do dono, mas só fazem exatamente o que está escrito
-- aqui. É pouca superfície e é auditável, ao contrário de uma chave que ignora
-- todas as regras do sistema.
--
-- O hash da senha (Argon2id) e o hash do token são calculados na aplicação.
-- O banco nunca vê a senha nem o token em texto puro.
-- =============================================================================

-- ------------------------------------------------------------------- login
create or replace function auth_credenciais(p_email text)
returns table (id uuid, nome text, email text, senha_hash text,
               papel papel_usuario, ativo boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.nome, u.email, u.senha_hash, u.papel, u.ativo
  from usuario u
  where u.email = lower(trim(p_email))
$$;

create or replace function auth_criar_sessao(
  p_usuario_id uuid, p_token_hash text, p_expira_em timestamptz,
  p_ip text default null, p_agente text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into sessao (token_hash, usuario_id, expira_em, ip, agente)
  values (p_token_hash, p_usuario_id, p_expira_em, p_ip, p_agente);

  update usuario set ultimo_login = now() where id = p_usuario_id;
end $$;

create or replace function auth_ler_sessao(p_token_hash text)
returns table (id uuid, nome text, email text, papel papel_usuario, ativo boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.nome, u.email, u.papel, u.ativo
  from sessao s
  join usuario u on u.id = s.usuario_id
  where s.token_hash = p_token_hash
    and s.expira_em > now()
    and u.ativo
$$;

create or replace function auth_encerrar_sessao(p_token_hash text)
returns void
language sql security definer set search_path = public as $$
  delete from sessao where token_hash = p_token_hash
$$;

-- --------------------------------------------------- recuperação de senha
-- Devolve sempre void, exista ou não a conta: quem chama não consegue usar
-- este endpoint para descobrir quais e-mails estão cadastrados.
create or replace function auth_criar_token_recuperacao(
  p_email text, p_token_hash text, p_expira_em timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from usuario where email = lower(trim(p_email)) and ativo;
  if v_id is null then return; end if;

  insert into token_recuperacao (token_hash, usuario_id, expira_em)
  values (p_token_hash, v_id, p_expira_em);
end $$;

/* Consome o token e devolve o dono. Um token só serve uma vez: a marcação de
   uso acontece na mesma instrução que o valida, então duas requisições
   simultâneas não conseguem usá-lo duas vezes. */
create or replace function auth_usar_token_recuperacao(p_token_hash text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update token_recuperacao
     set usado_em = now()
   where token_hash = p_token_hash
     and usado_em is null
     and expira_em > now()
  returning usuario_id into v_id;

  return v_id;
end $$;

create or replace function auth_definir_senha(p_usuario_id uuid, p_senha_hash text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update usuario set senha_hash = p_senha_hash where id = p_usuario_id;
  -- Trocar a senha derruba todas as sessões abertas daquele usuário.
  delete from sessao where usuario_id = p_usuario_id;
end $$;

grant execute on function
  auth_credenciais(text),
  auth_criar_sessao(uuid, text, timestamptz, text, text),
  auth_ler_sessao(text),
  auth_encerrar_sessao(text),
  auth_criar_token_recuperacao(text, text, timestamptz),
  auth_usar_token_recuperacao(text),
  auth_definir_senha(uuid, text)
to app_web;

-- =============================================================================
-- ↓↓↓  PARTE 9 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 9 — Check-in público por QR Code (RF26 a RF34)
--
-- O participante não tem conta, logo não existe usuário para o RLS avaliar.
-- Em vez de dar à aplicação uma chave que ignora todas as regras, o acesso
-- público passa por estas três funções: elas rodam com privilégio de dono, mas
-- fazem só o que está escrito, e toda a regra fica em um lugar auditável.
-- =============================================================================

-- Está aberto? Sem janela definida, vale o dia da reunião — assim uma reunião
-- cadastrada às pressas não fica com o check-in travado.
create or replace function checkin_aberto(r reuniao) returns boolean
language sql stable as $$
  select case
    when r.status in ('cancelada','encerrada') then false
    when r.checkin_abre_em  is not null and now() < r.checkin_abre_em  then false
    when r.checkin_fecha_em is not null and now() > r.checkin_fecha_em then false
    when r.checkin_abre_em is null and r.checkin_fecha_em is null
      then r.data = current_date
    else true
  end
$$;

-- ------------------------------------------------- dados públicos da reunião
create or replace function checkin_reuniao(p_token text)
returns table (titulo text, data date, hora_inicio time, local text,
               status status_reuniao, aberto boolean)
language sql stable security definer set search_path = public as $$
  select r.titulo, r.data, r.hora_inicio, r.local, r.status, checkin_aberto(r.*)
  from reuniao r
  where r.qr_token = p_token
$$;

-- ------------------------------------------------------- busca de participante
-- Só quem tem vínculo ativo aparece, no máximo 5 resultados. Devolver nome e
-- instituição de quem ainda não confirmou presença é uma exposição pequena mas
-- real; os dois limites dificultam varrer a base por este caminho.
create or replace function checkin_buscar(p_token text, p_termo text)
returns table (pessoa_id uuid, nome text, instituicao text,
               cargo text, vinculo_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare r reuniao;
begin
  select * into r from reuniao where qr_token = p_token;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if not checkin_aberto(r) then raise exception 'CHECKIN_FECHADO'; end if;
  if length(trim(p_termo)) < 3 then raise exception 'TERMO_CURTO'; end if;

  -- Casa quando TODAS as palavras digitadas aparecem no nome, em qualquer
  -- ordem. Quem digita "jose silva" encontra "José da Silva Júnior" — a busca
  -- por frase inteira não encontraria, por causa do "da" no meio.
  return query
  select p.id, p.nome, i.nome, v.cargo, v.id
  from vinculo v
  join pessoa p      on p.id = v.pessoa_id
  join instituicao i on i.id = v.instituicao_id
  where v.status = 'ativo'
    and (select bool_and(p.nome_busca like '%' || palavra || '%')
         from unnest(string_to_array(imutavel_unaccent(lower(trim(p_termo))), ' ')) palavra
         where palavra <> '')
  order by similarity(p.nome_busca, imutavel_unaccent(lower(trim(p_termo)))) desc, p.nome
  limit 5;
end $$;

-- ------------------------------------------------------- registro de presença
-- Passa p_pessoa_id para representante identificado; passa os dados livres para
-- convidado. Devolve o registro criado — ou o que já existia, se a pessoa já
-- tinha feito check-in (RF34): para ela isso é sucesso, não erro.
create or replace function checkin_registrar(
  p_token       text,
  p_pessoa_id   uuid    default null,
  p_nome        text    default null,
  p_email       text    default null,
  p_instituicao text    default null)
-- Os nomes de saída são propositalmente diferentes dos nomes das colunas:
-- dentro de uma função, um parâmetro de saída chamado "nome" sequestra
-- qualquer referência a uma coluna "nome" e o erro é difícil de enxergar.
returns table (out_presenca_id uuid, out_participante text, out_instituicao text,
               out_cargo text, out_tipo tipo_participante,
               out_registrado_em timestamptz, out_ja_existia boolean)
language plpgsql security definer set search_path = public as $$
declare
  r          reuniao;
  v          vinculo;
  v_pessoa   pessoa;
  v_inst     text;
  v_cargo    text;
  v_id       uuid;
  v_horario  timestamptz;
begin
  select * into r from reuniao where qr_token = p_token;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if r.status = 'cancelada' then raise exception 'REUNIAO_CANCELADA'; end if;
  if not checkin_aberto(r) then raise exception 'CHECKIN_FECHADO'; end if;

  -- ------------------------------------------------------------- convidado
  if p_pessoa_id is null then
    if p_nome is null or length(trim(p_nome)) < 3 then
      raise exception 'NOME_INVALIDO';
    end if;

    insert into presenca (reuniao_id, tipo, status, origem, horario_checkin,
                          nome_informado, email_informado, instituicao_informada)
    values (r.id, 'convidado', 'presente', 'qrcode', now(),
            trim(p_nome), nullif(trim(coalesce(p_email,'')), ''),
            nullif(trim(coalesce(p_instituicao,'')), ''))
    returning id, horario_checkin into v_id, v_horario;

    return query select v_id, trim(p_nome), nullif(trim(coalesce(p_instituicao,'')),''),
                        null::text, 'convidado'::tipo_participante, v_horario, false;
    return;
  end if;

  -- --------------------------------------------------------- representante
  select * into v_pessoa from pessoa pe where pe.id = p_pessoa_id;
  if not found then raise exception 'PESSOA_NAO_ENCONTRADA'; end if;

  -- Já registrou? Devolve o registro anterior em vez de falhar (RF34).
  select pr.id, pr.horario_checkin into v_id, v_horario
  from presenca pr where pr.reuniao_id = r.id and pr.pessoa_id = p_pessoa_id;

  if found then
    select i.nome, pr.cargo_no_momento into v_inst, v_cargo
    from presenca pr left join instituicao i on i.id = pr.instituicao_id
    where pr.id = v_id;

    return query select v_id, v_pessoa.nome, v_inst, v_cargo,
                        'representante'::tipo_participante, v_horario, true;
    return;
  end if;

  -- Vínculo válido NA DATA DA REUNIÃO, não o atual — é o snapshot (RF31).
  select * into v from vinculo vi
   where vi.pessoa_id = p_pessoa_id
     and vi.data_inicio <= r.data
     and (vi.data_fim is null or vi.data_fim >= r.data)
   order by (vi.status = 'ativo') desc, vi.data_inicio desc
   limit 1;

  if not found then raise exception 'VINCULO_INVALIDO'; end if;

  select i.nome into v_inst from instituicao i where i.id = v.instituicao_id;

  insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id,
                        cargo_no_momento, tipo, status, origem, horario_checkin)
  values (r.id, p_pessoa_id, v.id, v.instituicao_id, v.cargo,
          'representante', 'presente', 'qrcode', now())
  returning id, horario_checkin into v_id, v_horario;

  return query select v_id, v_pessoa.nome, v_inst, v.cargo,
                      'representante'::tipo_participante, v_horario, false;
end $$;

grant execute on function
  checkin_reuniao(text),
  checkin_buscar(text, text),
  checkin_registrar(text, uuid, text, text, text)
to app_web;

-- =============================================================================
-- ↓↓↓  PARTE 10 de 10
-- =============================================================================

-- =============================================================================
-- PARTE 10 — Carga inicial (dados de domínio, não de teste)
-- =============================================================================

insert into tipo_instituicao (nome) values
  ('Universidade'),
  ('Instituto de pesquisa'),
  ('Startup'),
  ('Empresa'),
  ('Poder público'),
  ('Associação / entidade de classe'),
  ('Incubadora / aceleradora'),
  ('Sistema S');
