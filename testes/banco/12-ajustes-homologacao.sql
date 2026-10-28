-- =============================================================================
-- TESTES DA 017 — fuso do banco e auditoria sem ruído de login.
-- =============================================================================

\set ON_ERROR_STOP on

do $$
begin
  if (select setting from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase
       cross join unnest(s.setconfig) as setting
      where d.datname = current_database() and s.setrole = 0
        and lower(setting) like 'timezone=%' limit 1) is null then
    raise exception 'FALHOU: o banco não tem fuso padrão configurado';
  end if;
  raise notice 'OK   fuso — o banco abre as conexões em America/Sao_Paulo';
end $$;

do $$
declare v_antes int; v_depois int;
begin
  begin
    select count(*) into v_antes from log_auditoria where entidade = 'usuario';
    update usuario set ultimo_login = now() where id = '11111111-1111-1111-1111-111111111111';
    select count(*) into v_depois from log_auditoria where entidade = 'usuario';
    if v_depois <> v_antes then raise exception 'FALHOU: login gerou linha no histórico'; end if;
    update usuario set nome = 'Ana Teste' where id = '11111111-1111-1111-1111-111111111111';
    select count(*) into v_depois from log_auditoria where entidade = 'usuario';
    if v_depois <> v_antes + 1 then raise exception 'FALHOU: alteração de verdade deixou de ser auditada'; end if;
    raise notice 'OK   auditoria — login não vira histórico; alteração de verdade continua virando';
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;
