-- =============================================================================
-- 007 — Controle de acesso no banco (RF03, RNF15)
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
