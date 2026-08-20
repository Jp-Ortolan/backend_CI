-- =============================================================================
-- TESTES DE REGRA DE NEGÓCIO
--
-- Cada bloco tenta violar uma regra e espera que o BANCO recuse.
-- Se o banco aceitar, o teste levanta exceção e o script falha (exit != 0).
--
-- Pré-requisito: migrations + seed aplicados.
-- Uso: psql -v ON_ERROR_STOP=1 -f tests/01-regras-de-negocio.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into presenca (reuniao_id, tipo, status, horario_checkin, nome_informado, vinculo_id)
    values ('dddddddd-0000-0000-0000-000000000001', 'convidado', 'presente', now(),
            'Invasor', 'cccccccc-0000-0000-0000-000000000001');
    raise exception 'FALHOU RF33: o banco aceitou um convidado com vínculo oficial';
  exception when check_violation then
    raise notice 'OK   RF33 — convidado com vínculo foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into presenca (reuniao_id, pessoa_id, tipo, status, horario_checkin)
    values ('dddddddd-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000001', 'representante', 'presente', now());
    raise exception 'FALHOU RF34: o banco aceitou check-in duplicado na mesma reunião';
  exception when unique_violation then
    raise notice 'OK   RF34 — check-in duplicado foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into vinculo (pessoa_id, instituicao_id, status, data_inicio)
    values ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000002', 'ativo', current_date);
    raise exception 'FALHOU: o banco aceitou dois vínculos ativos na mesma instituição';
  exception when unique_violation then
    raise notice 'OK   vínculo — dois vínculos ativos na mesma instituição recusados';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into vinculo (pessoa_id, instituicao_id, status, data_inicio)
    values ('bbbbbbbb-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000003', 'encerrado', '2020-01-01');
    raise exception 'FALHOU RF16: o banco aceitou vínculo encerrado sem data de fim';
  exception when check_violation then
    raise notice 'OK   RF16 — vínculo encerrado sem data_fim foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update instituicao set status = 'inativa'
     where id = 'aaaaaaaa-0000-0000-0000-000000000002';
    raise exception 'FALHOU RF09: o banco aceitou instituição inativa sem data de saída';
  exception when check_violation then
    raise notice 'OK   RF09 — instituição inativa sem data_saida foi recusada';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into instituicao (nome, cnpj) values ('Teste Formatação', '12.345.678/0001-90');
    raise exception 'FALHOU RF13: o banco aceitou CNPJ com pontuação';
  exception when check_violation or string_data_right_truncation then
    raise notice 'OK   RF13 — CNPJ com pontuação foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into instituicao (nome, cnpj) values ('Duplicata', '11111111111111');
    raise exception 'FALHOU RF13: o banco aceitou dois CNPJ iguais';
  exception when unique_violation then
    raise notice 'OK   RF13 — CNPJ duplicado foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into documento (nome, storage_path) values ('Ata solta', 'tmp/ata.pdf');
    raise exception 'FALHOU: o banco aceitou documento sem instituição nem reunião';
  exception when check_violation then
    raise notice 'OK   documento — documento sem dono foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare qtd int;
begin
  update instituicao
     set status = 'em_processo_saida',
         updated_by = '11111111-1111-1111-1111-111111111111'
   where id = 'aaaaaaaa-0000-0000-0000-000000000002';

  select count(*) into qtd
    from instituicao_status_historico
   where instituicao_id = 'aaaaaaaa-0000-0000-0000-000000000002'
     and status_anterior = 'ativa' and status_novo = 'em_processo_saida';

  if qtd < 1 then
    raise exception 'FALHOU RF10: a mudança de status não gerou histórico';
  end if;
  raise notice 'OK   RF10 — mudança de status gerou histórico automaticamente';

  -- desfaz para não interferir nos testes de indicadores
  update instituicao set status = 'ativa',
         updated_by = '11111111-1111-1111-1111-111111111111'
   where id = 'aaaaaaaa-0000-0000-0000-000000000002';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare achou int;
begin
  select count(*) into achou from pessoa where nome_busca % 'jose silva junior';
  if achou < 1 then
    raise exception 'FALHOU RNF06: busca sem acento não encontrou "José da Silva Júnior"';
  end if;
  raise notice 'OK   RNF06 — busca sem acento e aproximada encontrou o participante';
end $$;

\echo ''
\echo '== 01-regras-de-negocio: todos os testes passaram =='
