-- =============================================================================
-- 016 — Relatórios e importação  ·  feature/relatorios-e-importacao
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
--   1. relatorio_gerado — o arquivo (xlsx/pdf) fica guardado por pouco tempo,
--      só para quem o gerou, e sai por link assinado de 15 minutos. Nada de
--      pasta pública.
--   2. importacao_previa / importacao — importação em duas etapas: validar
--      (não toca em registro oficial) e confirmar (uma transação, idempotente
--      pela prévia). A prévia é da conta que validou e vence em 30 minutos.
-- =============================================================================

begin;

create table relatorio_gerado (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuario(id) on delete cascade,
  escopo      text not null,
  nome        text not null,
  mime_type   text not null,
  conteudo    bytea not null,
  created_at  timestamptz not null default now(),
  expira_em   timestamptz not null default now() + interval '1 hour'
);
create index relatorio_gerado_expira_idx on relatorio_gerado (expira_em);

alter table relatorio_gerado enable row level security;
create policy relatorio_gerado_proprio on relatorio_gerado
  for all using (usuario_id = usuario_atual_id()) with check (usuario_id = usuario_atual_id());
grant select, insert, delete on relatorio_gerado to app_web;

create table importacao_previa (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references usuario(id) on delete cascade,
  tipo           text not null check (tipo in ('instituicoes', 'presencas')),
  hash_arquivo   text not null,
  nome_arquivo   text,
  linhas         jsonb not null,
  resumo         jsonb not null,
  created_at     timestamptz not null default now(),
  expira_em      timestamptz not null default now() + interval '30 minutes',
  confirmada_em  timestamptz,
  importacao_id  uuid
);

create table importacao (
  id          uuid primary key default gen_random_uuid(),
  previa_id   uuid not null unique references importacao_previa(id),
  usuario_id  uuid references usuario(id) on delete set null,
  tipo        text not null,
  status      text not null default 'concluida' check (status in ('concluida')),
  importados  integer not null,
  nome_arquivo text,
  created_at  timestamptz not null default now()
);

create trigger importacao_auditoria after insert on importacao
  for each row execute function tg_auditar();

alter table importacao_previa enable row level security;
alter table importacao enable row level security;
-- Importar é do administrador; a prévia é só de quem validou.
create policy importacao_previa_propria on importacao_previa
  for all using (usuario_id = usuario_atual_id() and papel_atual() = 'admin')
  with check (usuario_id = usuario_atual_id() and papel_atual() = 'admin');
create policy importacao_ler on importacao for select using (papel_atual() = 'admin');
create policy importacao_inserir on importacao for insert
  with check (papel_atual() = 'admin' and usuario_id = usuario_atual_id());
grant select, insert, update on importacao_previa to app_web;
grant select, insert on importacao to app_web;

commit;
