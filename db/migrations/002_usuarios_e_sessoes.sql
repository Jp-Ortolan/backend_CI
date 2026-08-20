-- =============================================================================
-- 002 — Usuários, sessões e recuperação de senha
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
