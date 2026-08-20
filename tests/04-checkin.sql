-- =============================================================================
-- TESTES DO CHECK-IN PÚBLICO
--
-- O fluxo inteiro do QR Code vive em três funções do banco. Testar aqui é mais
-- forte do que testar pela aplicação: se a regra vale no banco, vale para
-- qualquer código que chegar nele.
--
-- Uso: psql -v ON_ERROR_STOP=1 -f tests/04-checkin.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- reunião de hoje, com check-in aberto
insert into reuniao (id, titulo, data, status, qr_token)
values ('ffffffff-0000-0000-0000-000000000001', 'Reunião de teste — hoje',
        current_date, 'agendada', 'token_de_teste_aberto')
on conflict (id) do nothing;

-- reunião de ontem, já encerrada
insert into reuniao (id, titulo, data, status, qr_token)
values ('ffffffff-0000-0000-0000-000000000002', 'Reunião de teste — ontem',
        current_date - 1, 'encerrada', 'token_de_teste_fechado')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------- RF27
do $$
declare r record;
begin
  select * into r from checkin_reuniao('token_de_teste_aberto');
  if not found or not r.aberto then
    raise exception 'FALHOU RF27: reunião de hoje deveria estar aberta para check-in';
  end if;
  raise notice 'OK   RF27 — reunião de hoje aceita check-in';

  select * into r from checkin_reuniao('token_de_teste_fechado');
  if r.aberto then
    raise exception 'FALHOU RNF13: reunião encerrada não deveria aceitar check-in';
  end if;
  raise notice 'OK   RNF13 — reunião encerrada não aceita check-in';
end $$;

-- ---------------------------------------------------------------------- RNF12
do $$
declare achou int;
begin
  select count(*) into achou from checkin_reuniao('token_que_nao_existe');
  if achou <> 0 then
    raise exception 'FALHOU RNF12: token inexistente devolveu reunião';
  end if;
  raise notice 'OK   RNF12 — token inexistente não chega a reunião nenhuma';
end $$;

-- ---------------------------------------------------------------------- RF28
do $$
declare achou int; nome_encontrado text;
begin
  select count(*), min(nome) into achou, nome_encontrado
  from checkin_buscar('token_de_teste_aberto', 'jose silva');
  if achou <> 1 then
    raise exception 'FALHOU RF28: busca por "jose silva" devolveu % resultados', achou;
  end if;
  if nome_encontrado <> 'José da Silva Júnior' then
    raise exception 'FALHOU RF28: encontrou "%" em vez de José da Silva Júnior', nome_encontrado;
  end if;
  raise notice 'OK   RF28 — busca por palavras soltas e sem acento encontra o participante';
end $$;

do $$
begin
  begin
    perform checkin_buscar('token_de_teste_aberto', 'jo');
    raise exception 'FALHOU RNF14: busca aceitou menos de 3 caracteres';
  exception when raise_exception then
    if sqlerrm = 'TERMO_CURTO' then
      raise notice 'OK   RNF14 — busca exige ao menos 3 caracteres';
    else raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------- RF29 e RF31
do $$
declare r record;
begin
  select * into r from checkin_registrar('token_de_teste_aberto',
                                         'bbbbbbbb-0000-0000-0000-000000000001');
  if r.out_instituicao <> 'Startup Beta' then
    raise exception 'FALHOU RF29: identificou a instituição como "%"', r.out_instituicao;
  end if;
  if r.out_cargo <> 'CTO' then
    raise exception 'FALHOU RF29: cargo veio como "%"', r.out_cargo;
  end if;
  if r.out_ja_existia then
    raise exception 'FALHOU: primeiro check-in veio marcado como repetido';
  end if;
  raise notice 'OK   RF29 — instituição e cargo identificados sozinhos (% · %)',
    r.out_instituicao, r.out_cargo;
end $$;

-- ---------------------------------------------------------------------- RF34
do $$
declare r record;
begin
  select * into r from checkin_registrar('token_de_teste_aberto',
                                         'bbbbbbbb-0000-0000-0000-000000000001');
  if not r.out_ja_existia then
    raise exception 'FALHOU RF34: segundo check-in criou um registro novo';
  end if;
  raise notice 'OK   RF34 — check-in repetido devolve o registro anterior, não erro';
end $$;

-- ---------------------------------------------------------------- RF32 e RF33
do $$
declare r record; virou_representante int;
begin
  select * into r from checkin_registrar('token_de_teste_aberto', null,
                                         'Patrícia Nogueira', 'p@empresax.br', 'Empresa X');
  if r.out_tipo <> 'convidado' then
    raise exception 'FALHOU RF32: convidado registrado como %', r.out_tipo;
  end if;
  raise notice 'OK   RF32 — participante não encontrado registra como convidado';

  select count(*) into virou_representante
  from presenca where id = r.out_presenca_id and vinculo_id is not null;
  if virou_representante > 0 then
    raise exception 'FALHOU RF33: convidado ficou com vínculo institucional';
  end if;
  raise notice 'OK   RF33 — convidado não vira representante de instituição nenhuma';
end $$;

-- ---------------------------------------------------------------------- RNF13
do $$
begin
  begin
    perform checkin_registrar('token_de_teste_fechado',
                              'bbbbbbbb-0000-0000-0000-000000000002');
    raise exception 'FALHOU RNF13: aceitou check-in em reunião encerrada';
  exception when raise_exception then
    if sqlerrm = 'CHECKIN_FECHADO' then
      raise notice 'OK   RNF13 — check-in fora da janela foi recusado';
    else raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------- RF31
-- O snapshot precisa apontar para a instituição da ÉPOCA da reunião.
do $$
declare inst text;
begin
  -- Reunião com data de 2025 mas com a janela de check-in aberta agora: é o
  -- caso de uma reunião antiga reaberta para regularizar um registro. O que
  -- importa aqui é que o vínculo usado seja o da DATA DA REUNIÃO, não o de hoje.
  insert into reuniao (id, titulo, data, status, qr_token,
                       checkin_abre_em, checkin_fecha_em)
  values ('ffffffff-0000-0000-0000-000000000003', 'Reunião de teste — março/2025',
          '2025-03-10', 'agendada', 'token_de_teste_2025',
          now() - interval '1 hour', now() + interval '1 hour')
  on conflict (id) do nothing;

  perform checkin_registrar('token_de_teste_2025', 'bbbbbbbb-0000-0000-0000-000000000001');

  select i.nome into inst
  from presenca p join instituicao i on i.id = p.instituicao_id
  where p.reuniao_id = 'ffffffff-0000-0000-0000-000000000003'
    and p.pessoa_id  = 'bbbbbbbb-0000-0000-0000-000000000001';

  if inst <> 'Universidade Alfa' then
    raise exception 'FALHOU RF31: presença de março/2025 ficou com "%" em vez de Universidade Alfa', inst;
  end if;
  raise notice 'OK   RF31 — presença antiga usa o vínculo da época (%), não o atual', inst;

  delete from presenca where reuniao_id = 'ffffffff-0000-0000-0000-000000000003';
  delete from reuniao where id = 'ffffffff-0000-0000-0000-000000000003';
end $$;

-- limpeza
delete from presenca where reuniao_id in ('ffffffff-0000-0000-0000-000000000001',
                                          'ffffffff-0000-0000-0000-000000000002');
delete from reuniao  where id in ('ffffffff-0000-0000-0000-000000000001',
                                  'ffffffff-0000-0000-0000-000000000002');

\echo ''
\echo '== 04-checkin: todos os testes passaram =='
