-- Migration 008 — sincronizar auth.users com a tabela usuario
--
-- Sem isto, quem se cadastra existe para o Supabase Auth e NÃO existe para o
-- sistema: papel_atual() devolve nulo, o RLS bloqueia tudo e a tela parece
-- quebrada sem motivo aparente.

create or replace function tg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuario (id, nome, email, papel)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nome'), ''),
             split_part(new.email, '@', 1)),
    new.email,
    'leitura'          -- promoção a gestor/admin é ação manual do administrador
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function tg_novo_usuario();
