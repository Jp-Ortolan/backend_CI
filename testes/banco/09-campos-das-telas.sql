-- =============================================================================
-- TESTES DA MIGRATION 006 — CPF, link e senha da reunião
--
-- Pré-requisito: migrations 001 a 006 + seed aplicados.
-- Uso: npm run db:testar
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare v_id uuid;
begin
  insert into pessoa (nome, cpf) values ('Teste CPF', '52998224725') returning id into v_id;
  raise notice 'OK   cpf — grava os 11 dígitos';
  delete from pessoa where id = v_id;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  -- A pontuação é decoração de tela: no banco só entra dígito.
  begin
    insert into pessoa (nome, cpf) values ('Com ponto', '529.982.247-25');
    raise exception 'FALHOU: aceitou CPF com pontuação';
  exception when check_violation or string_data_right_truncation then
    raise notice 'OK   cpf — recusa pontuação';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_a uuid;
begin
  insert into pessoa (nome, cpf) values ('Primeiro', '11144477735') returning id into v_a;
  begin
    insert into pessoa (nome, cpf) values ('Segundo', '11144477735');
    raise exception 'FALHOU: aceitou o mesmo CPF duas vezes';
  exception when unique_violation then
    raise notice 'OK   cpf — não repete';
  end;
  delete from pessoa where id = v_a;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_b uuid;
begin
  -- Nulo repetido tem que passar: quem já estava cadastrado não tem CPF.
  insert into pessoa (nome) values ('Sem CPF 1') returning id into v_a;
  insert into pessoa (nome) values ('Sem CPF 2') returning id into v_b;
  raise notice 'OK   cpf — vários nulos convivem';
  delete from pessoa where id in (v_a, v_b);
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  insert into reuniao (titulo, data, link, senha_acesso)
       values ('Reunião on-line', current_date + 1, 'https://meet.google.com/abc-defg-hij', 'sala123')
    returning id into v_id;
  raise notice 'OK   reuniao — grava link e senha de acesso';
  delete from reuniao where id = v_id;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into reuniao (titulo, data, link) values ('Link torto', current_date + 1, 'meet.google.com/abc');
    raise exception 'FALHOU: aceitou link sem http';
  exception when check_violation then
    raise notice 'OK   reuniao — recusa link sem http';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_assinatura text;
begin
  -- A rota pública de check-in lê por checkin_reuniao(), que tem lista fixa de
  -- colunas. Se alguém trocar por "select *", a senha da sala vaza para quem
  -- só leu o QR Code.
  v_assinatura := pg_get_function_result('checkin_reuniao(text)'::regprocedure);

  if v_assinatura ilike '%senha%' or v_assinatura ilike '%link%' then
    raise exception 'FALHOU: checkin_reuniao() passou a devolver link ou senha (%)', v_assinatura;
  end if;
  raise notice 'OK   checkin — a função pública não devolve link nem senha';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from tipo_instituicao
   where nome in ('Faculdade', 'Centro de inovação');
  if v_n <> 2 then
    raise exception 'FALHOU: esperava os 2 tipos novos, achei %', v_n;
  end if;
  raise notice 'OK   dominios — Faculdade e Centro de inovação existem';
end $$;
