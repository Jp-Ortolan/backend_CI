-- =============================================================================
-- TESTES DA MIGRATION 005 — limite de tentativas no check-in (RNF14)
--
-- Pré-requisito: migrations 001 a 005 + seed aplicados.
-- Uso: psql -v ON_ERROR_STOP=1 -f testes/banco/08-protecao-checkin.sql
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare v_total integer;
begin
  -- A função conta e devolve o total na janela; quem decide o limite é a
  -- aplicação. Aqui se prova que a contagem sobe.
  for i in 1..5 loop
    v_total := checkin_contar_tentativa('203.0.113.10', 'buscar', 'tok-a');
  end loop;

  if v_total <> 5 then
    raise exception 'FALHOU: esperava 5 tentativas contadas, veio %', v_total;
  end if;
  raise notice 'OK   limite — a contagem sobe a cada tentativa (%)', v_total;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_outro integer;
begin
  -- IP diferente tem contador próprio, senão um usuário barraria todos os
  -- outros.
  v_outro := checkin_contar_tentativa('203.0.113.99', 'buscar', 'tok-a');
  if v_outro <> 1 then
    raise exception 'FALHOU: IP novo começou em %, deveria começar em 1', v_outro;
  end if;
  raise notice 'OK   limite — cada IP tem o próprio contador';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_registrar integer;
begin
  -- Ações diferentes contam separado: buscar é mais restrito que registrar,
  -- e quem buscou muito não pode ficar impedido de confirmar a presença.
  v_registrar := checkin_contar_tentativa('203.0.113.10', 'registrar', 'tok-a');
  if v_registrar <> 1 then
    raise exception 'FALHOU: a ação "registrar" herdou a contagem de "buscar" (%)',
      v_registrar;
  end if;
  raise notice 'OK   limite — buscar e registrar contam separado';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_antigo integer;
begin
  -- Fora da janela não conta. Sem isso o limite seria permanente: quem
  -- estourasse uma vez ficaria bloqueado para sempre.
  insert into checkin_tentativa (ip, acao, criada_em)
  values ('203.0.113.20', 'buscar', now() - interval '10 minutes');

  v_antigo := checkin_contar_tentativa('203.0.113.20', 'buscar', null,
                                        interval '1 minute');
  if v_antigo <> 1 then
    raise exception 'FALHOU: tentativa de 10 minutos atrás ainda conta (%)', v_antigo;
  end if;
  raise notice 'OK   limite — tentativa fora da janela não conta mais';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_sem_ip integer;
begin
  -- Sem IP, tudo cai num "desconhecido" só. Mais restritivo de propósito:
  -- deixar passar seria abrir a porta para quem esconde o IP.
  v_sem_ip := checkin_contar_tentativa('', 'buscar', 'tok-a');
  if not exists (select 1 from checkin_tentativa where ip = 'desconhecido') then
    raise exception 'FALHOU: tentativa sem IP não foi agrupada';
  end if;
  raise notice 'OK   limite — tentativa sem IP vira "desconhecido", não passa livre';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_linhas int;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '', true);

  -- A tabela guarda IP de participante: é dado pessoal e não pode ficar
  -- legível sem usuário declarado.
  select count(*) into v_linhas from checkin_tentativa;
  if v_linhas <> 0 then
    raise exception 'FALHOU: as tentativas ficaram legíveis sem usuário (% linhas)',
      v_linhas;
  end if;
  raise notice 'OK   RLS — tentativas não são legíveis sem usuário declarado';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_gestor int; v_admin int;
begin
  set local role app_web;

  -- Gestor não enxerga; admin enxerga. IP é dado pessoal.
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true);
  select count(*) into v_gestor from checkin_tentativa;

  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into v_admin from checkin_tentativa;

  if v_gestor <> 0 then
    raise exception 'FALHOU: gestor enxergou % linhas de tentativa', v_gestor;
  end if;
  if v_admin < 1 then
    raise exception 'FALHOU: administrador deveria enxergar as tentativas';
  end if;
  raise notice 'OK   RLS — só administrador enxerga as tentativas (admin vê %)', v_admin;
end $$;

do $$ begin raise notice ''; raise notice
  '== 08-protecao-checkin: todos os testes passaram =='; end $$;
