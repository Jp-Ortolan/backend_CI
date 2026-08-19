-- Migration 006 — Row Level Security (RF03, RNF15)
--
-- Regra geral: usuário autenticado lê; apenas admin e gestor escrevem.
-- A página pública de check-in NÃO passa por aqui — ela usa uma Edge Function
-- com service role, que valida o qr_token antes de gravar.

create or replace function papel_atual() returns papel_usuario
language sql stable security definer set search_path = public as $$
  select papel from usuario where id = auth.uid()
$$;

alter table usuario                      enable row level security;
alter table tipo_instituicao             enable row level security;
alter table instituicao                  enable row level security;
alter table instituicao_status_historico enable row level security;
alter table pessoa                       enable row level security;
alter table vinculo                      enable row level security;
alter table reuniao                      enable row level security;
alter table presenca                     enable row level security;
alter table documento                    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tipo_instituicao','instituicao','instituicao_status_historico',
                           'pessoa','vinculo','reuniao','presenca','documento']
  loop
    execute format(
      'create policy %I_leitura on %I for select using (auth.uid() is not null)', t, t);
    execute format(
      'create policy %I_escrita on %I for all
         using (papel_atual() in (''admin'',''gestor''))
         with check (papel_atual() in (''admin'',''gestor''))', t, t);
  end loop;
end $$;

-- usuario: cada um lê o próprio registro; só admin administra a tabela.
create policy usuario_leitura_propria on usuario
  for select using (id = auth.uid() or papel_atual() = 'admin');
create policy usuario_admin on usuario
  for all using (papel_atual() = 'admin') with check (papel_atual() = 'admin');
