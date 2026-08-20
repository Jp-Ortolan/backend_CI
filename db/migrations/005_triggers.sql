-- =============================================================================
-- 005 — Triggers de auditoria e histórico
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
