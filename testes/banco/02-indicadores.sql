-- =============================================================================
-- TESTES DOS INDICADORES
--
-- Conferem que as views calculam o que os requisitos RF41 a RF48 pedem,
-- usando o cenário do seed. Falham com exceção se o número mudar.
--
-- Uso: psql -v ON_ERROR_STOP=1 -f tests/02-indicadores.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- --------------------------------------------------------------------- RF44
-- A reunião só conta para quem já estava no ecossistema.
-- José representou a Universidade Alfa até 31/05/2025 e havia UMA reunião
-- encerrada nesse período (mar/2025), à qual ele compareceu -> 100%.
-- Pela Startup Beta, desde 01/06/2025, houve DUAS (ago e set/2025),
-- e ele compareceu a uma -> 50%.
do $$
declare alfa numeric; beta numeric;
begin
  select percentual_participacao into alfa from vw_participacao_representante
   where representante = 'José da Silva Júnior' and instituicao = 'Universidade Alfa';
  select percentual_participacao into beta from vw_participacao_representante
   where representante = 'José da Silva Júnior' and instituicao = 'Startup Beta';

  if alfa is distinct from 100.0 then
    raise exception 'FALHOU RF44: esperado 100.0%% na Universidade Alfa, veio %', alfa;
  end if;
  if beta is distinct from 50.0 then
    raise exception 'FALHOU RF44: esperado 50.0%% na Startup Beta, veio %', beta;
  end if;
  raise notice 'OK   RF44 — histórico separado por período do vínculo (Alfa %, Beta %)', alfa, beta;
end $$;

-- --------------------------------------------------------------------- RF17
-- A mesma pessoa aparece uma vez por instituição que representou.
do $$
declare linhas int;
begin
  select count(*) into linhas from vw_participacao_representante
   where representante = 'José da Silva Júnior';
  if linhas <> 2 then
    raise exception 'FALHOU RF17: esperadas 2 linhas para o representante, vieram %', linhas;
  end if;
  raise notice 'OK   RF17 — representante que trocou de instituição mantém as duas linhas';
end $$;

-- --------------------------------------------------------------------- RF43
do $$
declare r record;
begin
  select presentes, ausentes, convidados, percentual_presenca into r
    from vw_resumo_reuniao where titulo = 'Reunião Ordinária — Agosto/2025';
  if r.presentes <> 3 or r.convidados <> 1 then
    raise exception 'FALHOU RF43: esperado 3 presentes e 1 convidado, veio % e %',
      r.presentes, r.convidados;
  end if;
  raise notice 'OK   RF43 — resumo da reunião (% presentes, % convidado)', r.presentes, r.convidados;
end $$;

-- --------------------------------------------------------------------- RF46
do $$
declare d record;
begin
  select * into d from vw_dashboard;
  if d.instituicoes_ativas <> 3 then
    raise exception 'FALHOU RF46: esperadas 3 instituições ativas, vieram %', d.instituicoes_ativas;
  end if;
  if d.instituicoes_inativas <> 1 then
    raise exception 'FALHOU RF46: esperada 1 instituição inativa, veio %', d.instituicoes_inativas;
  end if;
  if d.reunioes_realizadas <> 3 then
    raise exception 'FALHOU RF46: esperadas 3 reuniões encerradas, vieram %', d.reunioes_realizadas;
  end if;
  if d.media_presenca is null then
    raise exception 'FALHOU RF46: média de presença veio nula';
  end if;
  raise notice 'OK   RF46 — dashboard (% ativas, % inativas, % reuniões, média %)',
    d.instituicoes_ativas, d.instituicoes_inativas, d.reunioes_realizadas, d.media_presenca;
end $$;

-- --------------------------------------------------------------------- RF45
-- O indicador é derivado: registrar uma presença muda o percentual na hora.
do $$
declare antes numeric; depois numeric;
begin
  select percentual_participacao into antes from vw_participacao_representante
   where representante = 'Carlos Antunes';

  update presenca set status = 'presente', horario_checkin = now()
   where pessoa_id = 'bbbbbbbb-0000-0000-0000-000000000003'
     and reuniao_id = 'dddddddd-0000-0000-0000-000000000003';

  select percentual_participacao into depois from vw_participacao_representante
   where representante = 'Carlos Antunes';

  if depois <= antes then
    raise exception 'FALHOU RF45: percentual não subiu ao registrar presença (% -> %)', antes, depois;
  end if;
  raise notice 'OK   RF45 — indicador derivado dos fatos (% -> %)', antes, depois;

  update presenca set status = 'ausente', horario_checkin = null
   where pessoa_id = 'bbbbbbbb-0000-0000-0000-000000000003'
     and reuniao_id = 'dddddddd-0000-0000-0000-000000000003';
end $$;

-- --------------------------------------------------------------------- RF31
-- O snapshot da presença aponta para a instituição da época, não a atual.
do $$
declare inst text;
begin
  select i.nome into inst
    from presenca pr join instituicao i on i.id = pr.instituicao_id
   where pr.reuniao_id = 'dddddddd-0000-0000-0000-000000000001'
     and pr.pessoa_id  = 'bbbbbbbb-0000-0000-0000-000000000001';
  if inst <> 'Universidade Alfa' then
    raise exception 'FALHOU RF31: presença de março/2025 aponta para "%" em vez da Universidade Alfa', inst;
  end if;
  raise notice 'OK   RF31 — presença antiga continua vinculada à instituição da época';
end $$;

\echo ''
\echo '== 02-indicadores: todos os testes passaram =='
