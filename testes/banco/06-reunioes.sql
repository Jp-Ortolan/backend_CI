-- =============================================================================
-- TESTES DA MIGRATION 003 — proteção da reunião e RLS nas views
--
-- Pré-requisito: migrations 001, 002 e 003 + seed aplicados.
-- Uso: psql -v ON_ERROR_STOP=1 -f testes/banco/06-reunioes.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- --------------------------------------------- exclusão de reunião protegida
do $$
begin
  begin
    -- A reunião de março/2025 tem presenças no seed. Sem a trigger, este delete
    -- passaria em silêncio e levaria as presenças junto por cascade.
    delete from reuniao where id = 'dddddddd-0000-0000-0000-000000000001';
    raise exception 'FALHOU: reunião com presenças foi excluída, e o histórico foi junto';
  exception when raise_exception then
    if sqlerrm not like '%REUNIAO_COM_PRESENCA%' then raise; end if;
    raise notice 'OK   reunião — exclusão com presenças foi barrada (%)', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_presencas_antes int; v_presencas_depois int;
begin
  select count(*) into v_presencas_antes from presenca;

  begin
    delete from reuniao where id = 'dddddddd-0000-0000-0000-000000000002';
  exception when raise_exception then null;
  end;

  select count(*) into v_presencas_depois from presenca;
  if v_presencas_antes <> v_presencas_depois then
    raise exception 'FALHOU: o delete recusado ainda apagou % presenças',
      v_presencas_antes - v_presencas_depois;
  end if;
  raise notice 'OK   reunião — nenhuma presença foi perdida na tentativa';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  -- Reunião marcada por engano, sem presença nem documento: essa pode sair.
  insert into reuniao (titulo, data) values ('Marcada errado', current_date + 30)
  returning id into v_id;

  delete from reuniao where id = v_id;

  if exists (select 1 from reuniao where id = v_id) then
    raise exception 'FALHOU: reunião sem histórico não foi excluída';
  end if;
  raise notice 'OK   reunião — reunião sem histórico pôde ser excluída';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_vinculo uuid;
begin
  -- Convite não é fato: reunião só com convites ainda pode ser apagada.
  insert into reuniao (titulo, data) values ('So convites', current_date + 31)
  returning id into v_id;

  select id into v_vinculo from vinculo where status = 'ativo' limit 1;
  insert into reuniao_convite (reuniao_id, vinculo_id, pessoa_id, instituicao_id)
  select v_id, v.id, v.pessoa_id, v.instituicao_id from vinculo v where v.id = v_vinculo;

  delete from reuniao where id = v_id;

  if exists (select 1 from reuniao where id = v_id) then
    raise exception 'FALHOU: reunião só com convites deveria poder ser excluída';
  end if;
  raise notice 'OK   reunião — convite não impede exclusão, presença impede';
end $$;

-- ------------------------------------------------- lista de participantes
do $$
declare v_reuniao uuid; v_total int; v_convidado int;
begin
  v_reuniao := 'dddddddd-0000-0000-0000-000000000002';

  select count(*) into v_total
    from vw_reuniao_participante where reuniao_id = v_reuniao;

  if v_total < 1 then
    raise exception 'FALHOU: a lista de participantes veio vazia';
  end if;

  -- O convidado avulso do seed não tem convite e não tem pessoa cadastrada:
  -- é exatamente a ponta que um join comum perderia.
  select count(*) into v_convidado
    from vw_reuniao_participante
   where reuniao_id = v_reuniao and tipo = 'convidado';

  if v_convidado < 1 then
    raise exception 'FALHOU: o convidado avulso sumiu da lista de participantes';
  end if;
  raise notice 'OK   participantes — % na lista, incluindo % convidado(s) sem convite',
    v_total, v_convidado;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_pendentes int;
begin
  -- Convidado que ainda não respondeu e não apareceu tem que constar na lista,
  -- senão a tela não teria como mostrar quem falta confirmar.
  perform convidar_representantes_ativos('dddddddd-0000-0000-0000-000000000004');

  select count(*) into v_pendentes
    from vw_reuniao_participante
   where reuniao_id = 'dddddddd-0000-0000-0000-000000000004'
     and status_confirmacao = 'pendente'
     and presenca_id is null;

  if v_pendentes < 1 then
    raise exception 'FALHOU: convidado sem resposta não aparece na lista';
  end if;
  raise notice 'OK   participantes — % convidado(s) pendente(s) aparecem sem presença',
    v_pendentes;
end $$;

-- ------------------------------------------------------- RLS nas views
do $$
declare v_linhas int;
begin
  set local role app_web;
  -- Nenhum usuário declarado na transação.
  perform set_config('app.usuario_id', '', true);

  select count(*) into v_linhas from vw_participacao_instituicao;
  if v_linhas <> 0 then
    raise exception 'FALHOU: a view devolveu % linhas sem usuário declarado — '
                    'o RLS está sendo contornado pela view', v_linhas;
  end if;
  raise notice 'OK   views — sem usuário declarado, a view não devolve nada';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_linhas int;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into v_linhas from vw_participacao_instituicao;
  if v_linhas < 1 then
    raise exception 'FALHOU: com usuário declarado a view deveria responder';
  end if;
  raise notice 'OK   views — com usuário declarado, a view responde normalmente';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_nome text;
begin
  set local role app_web;
  -- Gestor lendo o nome de OUTRO usuário: a exceção deliberada, que existe
  -- para o card "Cadastrada por" da tela de detalhe.
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true);

  select nome into v_nome from vw_usuario_publico
   where id = '11111111-1111-1111-1111-111111111111';

  if v_nome is null then
    raise exception 'FALHOU: vw_usuario_publico deveria mostrar o nome do autor';
  end if;
  raise notice 'OK   views — vw_usuario_publico segue mostrando a autoria (%)', v_nome;
end $$;

do $$ begin raise notice ''; raise notice
  '== 06-reunioes: todos os testes passaram =='; end $$;
