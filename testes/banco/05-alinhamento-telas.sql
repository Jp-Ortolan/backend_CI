-- =============================================================================
-- TESTES DA MIGRATION 002 — alinhamento com as telas
--
-- Cobre o que a 002 acrescentou: convite e confirmação, notificação, log de
-- auditoria, proteção da exclusão de instituição e a fórmula nova de presença.
--
-- Pré-requisito: migrations 001 e 002 + seed aplicados.
-- Uso: psql -v ON_ERROR_STOP=1 -f testes/banco/05-alinhamento-telas.sql
--
-- ATENÇÃO à armadilha já registrada no projeto: falta de política de UPDATE ou
-- DELETE não levanta erro, apenas não enxerga a linha. Os testes de permissão
-- daqui conferem o EFEITO (a linha continua lá?), nunca a exceção.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- cadastro
do $$
begin
  begin
    update instituicao set descricao = repeat('x', 501)
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHOU: o banco aceitou descrição acima de 500 caracteres';
  exception when check_violation then
    raise notice 'OK   cadastro — descrição acima de 500 caracteres foi recusada';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update instituicao set cep = '80000-00'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHOU: o banco aceitou CEP com pontuação';
  exception when check_violation then
    raise notice 'OK   cadastro — CEP com pontuação foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update instituicao set data_fundacao = current_date + 1
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHOU: o banco aceitou data de fundação no futuro';
  exception when check_violation then
    raise notice 'OK   cadastro — data de fundação no futuro foi recusada';
  end;
end $$;

-- ------------------------------------------------- convite e confirmação
do $$
declare convidados int; confirmados_antes int; confirmados_depois int;
begin
  -- A reunião de setembro/2026 ainda não tem convite nenhum.
  select convidar_representantes_ativos('dddddddd-0000-0000-0000-000000000004')
    into convidados;

  -- 3 vínculos ativos, mas o da Startup Beta e o da Universidade Alfa e o da
  -- Prefeitura são todos de instituição ativa: espera-se 3.
  if convidados <> 3 then
    raise exception 'FALHOU: esperava 3 convites, gerou %', convidados;
  end if;
  raise notice 'OK   convite — % vínculos ativos convidados de uma vez', convidados;

  -- Reexecutar não pode duplicar (a tela permite clicar duas vezes).
  select convidar_representantes_ativos('dddddddd-0000-0000-0000-000000000004')
    into convidados;
  if convidados <> 0 then
    raise exception 'FALHOU: reexecutar duplicou % convites', convidados;
  end if;
  raise notice 'OK   convite — reexecutar não duplicou ninguém';

  select confirmados into confirmados_antes
    from vw_resumo_reuniao where reuniao_id = 'dddddddd-0000-0000-0000-000000000004';

  update reuniao_convite
     set status = 'confirmado', respondido_em = now()
   where reuniao_id = 'dddddddd-0000-0000-0000-000000000004'
     and pessoa_id  = 'bbbbbbbb-0000-0000-0000-000000000001';

  select confirmados into confirmados_depois
    from vw_resumo_reuniao where reuniao_id = 'dddddddd-0000-0000-0000-000000000004';

  if confirmados_depois <> confirmados_antes + 1 then
    raise exception 'FALHOU: o contador de confirmados não subiu (% -> %)',
      confirmados_antes, confirmados_depois;
  end if;
  raise notice 'OK   convite — "N confirmados" do dashboard acompanha a resposta';
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    -- Mesmo vínculo, mesma reunião: a proposta do front pediu que isso fosse
    -- impossível.
    insert into reuniao_convite (reuniao_id, vinculo_id, pessoa_id, instituicao_id)
    values ('dddddddd-0000-0000-0000-000000000004',
            'cccccccc-0000-0000-0000-000000000002',
            'bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000002');
    raise exception 'FALHOU: o banco aceitou convite duplicado do mesmo vínculo';
  exception when unique_violation then
    raise notice 'OK   convite — participação duplicada na mesma reunião foi recusada';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into reuniao_convite (reuniao_id, vinculo_id, pessoa_id, instituicao_id,
                                 status, respondido_em)
    values ('dddddddd-0000-0000-0000-000000000003',
            'cccccccc-0000-0000-0000-000000000003',
            'bbbbbbbb-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'confirmado', null);
    raise exception 'FALHOU: o banco aceitou confirmação sem data de resposta';
  exception when check_violation then
    raise notice 'OK   convite — confirmação sem data de resposta foi recusada';
  end;
end $$;

-- ------------------------------------------------- exclusão de instituição
do $$
begin
  begin
    delete from instituicao where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHOU: instituição com histórico de presença foi excluída';
  exception when raise_exception then
    if sqlerrm not like '%INSTITUICAO_COM%' then raise; end if;
    raise notice 'OK   exclusão — instituição com histórico foi protegida (%)', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  -- Cadastro criado por engano, sem vínculo e sem presença: esse pode sair.
  insert into instituicao (nome, cnpj, status)
  values ('Cadastro Errado', '99999999999999', 'em_processo_entrada')
  returning id into v_id;

  delete from instituicao where id = v_id;

  if exists (select 1 from instituicao where id = v_id) then
    raise exception 'FALHOU: instituição sem histórico não foi excluída';
  end if;
  raise notice 'OK   exclusão — cadastro sem histórico pôde ser excluído';
end $$;

-- ------------------------------------------------------- log de auditoria
do $$
declare v_alteracoes jsonb; v_qtd int;
begin
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111111', false);

  update instituicao set telefone = '(42) 3633-3333', updated_by = usuario_atual_id()
   where id = 'aaaaaaaa-0000-0000-0000-000000000003';

  select alteracoes into v_alteracoes
    from log_auditoria
   where entidade = 'instituicao'
     and registro_id = 'aaaaaaaa-0000-0000-0000-000000000003'
     and acao = 'atualizacao'
   order by created_at desc limit 1;

  if v_alteracoes is null or not (v_alteracoes ? 'telefone') then
    raise exception 'FALHOU: a alteração de telefone não foi registrada';
  end if;
  if v_alteracoes ? 'updated_at' then
    raise exception 'FALHOU: updated_at poluiu o log de auditoria';
  end if;
  raise notice 'OK   auditoria — registrou só o campo que mudou (%)',
    v_alteracoes -> 'telefone' ->> 'depois';

  -- UPDATE que não muda nada não vira linha.
  select count(*) into v_qtd from log_auditoria
   where entidade = 'instituicao' and registro_id = 'aaaaaaaa-0000-0000-0000-000000000003';
  update instituicao set telefone = '(42) 3633-3333' where id = 'aaaaaaaa-0000-0000-0000-000000000003';
  if (select count(*) from log_auditoria
       where entidade = 'instituicao'
         and registro_id = 'aaaaaaaa-0000-0000-0000-000000000003') <> v_qtd then
    raise exception 'FALHOU: update sem mudança real gerou linha de log';
  end if;
  raise notice 'OK   auditoria — update que não mudou nada não virou linha';

  perform set_config('app.usuario_id', '', false);
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_tem_senha boolean;
begin
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111111', false);

  update usuario set nome = 'Ana Gestora da Silva'
   where id = '11111111-1111-1111-1111-111111111112';

  select bool_or(alteracoes::text like '%senha_hash%') into v_tem_senha
    from log_auditoria where entidade = 'usuario';

  if coalesce(v_tem_senha, false) then
    raise exception 'FALHOU RNF: o hash da senha vazou para o log de auditoria';
  end if;
  raise notice 'OK   auditoria — hash de senha não aparece no log';

  perform set_config('app.usuario_id', '', false);
end $$;

-- ----------------------------------------------------------- notificações
do $$
declare v_visiveis int;
begin
  insert into notificacao (usuario_id, titulo, mensagem, link) values
    ('11111111-1111-1111-1111-111111111111', 'Reunião amanhã', 'Auditório, 09:00', '/reunioes/x'),
    ('11111111-1111-1111-1111-111111111113', 'Nova instituição', 'Aguardando aprovação', '/instituicoes/y');

  set local role app_web;

  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true);
  select count(*) into v_visiveis from notificacao;

  if v_visiveis <> 1 then
    raise exception 'FALHOU: gestor enxergou % notificações, deveria enxergar só a dele', v_visiveis;
  end if;
  raise notice 'OK   notificação — cada usuário enxerga apenas as próprias';
end $$;

-- ---------------------------------------------------------------------------
-- Confere o EFEITO, não a exceção: sem política, o UPDATE simplesmente não
-- encontra a linha e "funciona" sem fazer nada.
do $$
declare v_lida timestamptz;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true);

  update notificacao set lida_em = now()
   where usuario_id = '11111111-1111-1111-1111-111111111111';

  reset role;
  select lida_em into v_lida from notificacao
   where usuario_id = '11111111-1111-1111-1111-111111111111' limit 1;

  if v_lida is not null then
    raise exception 'FALHOU: um usuário marcou como lida a notificação de outro';
  end if;
  raise notice 'OK   notificação — ninguém marca como lida a notificação alheia';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_qtd int;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true);

  select count(*) into v_qtd from log_auditoria;
  if v_qtd <> 0 then
    raise exception 'FALHOU: gestor enxergou % linhas do log de auditoria', v_qtd;
  end if;
  raise notice 'OK   auditoria — log é visível apenas para administrador';
end $$;

-- ------------------------------------------------------- fórmula da presença
do $$
declare v_esperados int; v_antiga numeric; v_nova numeric; v_convidados int;
begin
  -- Reunião de agosto/2025: 3 registros, sendo 1 convidado avulso.
  select esperados, percentual_presenca, percentual_comparecimento, convidados
    into v_esperados, v_antiga, v_nova, v_convidados
    from vw_resumo_reuniao
   where reuniao_id = 'dddddddd-0000-0000-0000-000000000002';

  if v_convidados < 1 then
    raise exception 'FALHOU: o cenário do teste precisa de ao menos um convidado';
  end if;

  if v_nova >= v_antiga then
    raise exception 'FALHOU: convidado avulso continua inflando o indicador (% vs %)',
      v_antiga, v_nova;
  end if;
  raise notice 'OK   presença — convidado avulso saiu da conta (antiga %, nova % sobre % esperados)',
    v_antiga, v_nova, v_esperados;
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_media numeric;
begin
  select media_presenca into v_media from vw_dashboard;
  if v_media is null then
    raise exception 'FALHOU: o dashboard ficou sem média de presença';
  end if;
  if v_media > 100 or v_media < 0 then
    raise exception 'FALHOU: média de presença fora da faixa (%)', v_media;
  end if;
  raise notice 'OK   dashboard — média de presença calculada sobre os esperados (%)', v_media;
end $$;

do $$ begin raise notice ''; raise notice
  '== 05-alinhamento-telas: todos os testes passaram =='; end $$;
