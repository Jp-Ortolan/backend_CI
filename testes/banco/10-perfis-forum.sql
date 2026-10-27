-- =============================================================================
-- TESTES DA REVISÃO DE OUTUBRO — migrations 007 a 011
--
-- Perfis do Fórum, recorte por instituição, guardas do representante,
-- solicitações, reunião x evento, check-in v2 e painel público.
--
-- Usuários do seed:
--   ...111  Ana     admin
--   ...113  Carla   diretoria
--   ...112  Bruno   representante da Universidade Alfa (sem pessoa)
--   ...114  Marina  representante da Universidade Alfa, ligada à pessoa Marina
--
-- Os blocos que mudam dado terminam com raise 'desfazer', capturado no próprio
-- bloco: o teste roda de verdade e o seed volta como estava para quem vem depois.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- perfis
do $$
begin
  if (select papel from usuario where id = '11111111-1111-1111-1111-111111111113') <> 'diretoria' then
    raise exception 'FALHOU: gestor não virou diretoria';
  end if;
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = 'papel_usuario' and e.enumlabel in ('gestor', 'leitura')) then
    raise exception 'FALHOU: papéis antigos continuam no enum';
  end if;
  raise notice 'OK   perfis — admin, diretoria e representante (gestor e leitura renomeados)';
end $$;

-- ---------------------------------------------------------- recorte por instituição
do $$
declare v_pessoas int; v_outras int; v_inst int; v_pres_outras int; v_conv_outras int;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111112', true); -- Bruno, Alfa

  select count(*) into v_inst from instituicao;
  select count(*) into v_pessoas from pessoa;
  select count(*) into v_outras from pessoa where id = 'bbbbbbbb-0000-0000-0000-000000000003'; -- Carlos, Prefeitura
  select count(*) into v_pres_outras from presenca
   where instituicao_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000001';

  if v_inst < 5 then raise exception 'FALHOU: representante deveria consultar todas as instituições (viu %)', v_inst; end if;
  if v_outras <> 0 then raise exception 'FALHOU: representante da Alfa enxergou pessoa da Prefeitura'; end if;
  if v_pessoas <> 2 then raise exception 'FALHOU: representante da Alfa deveria ver 2 pessoas (José e Marina), viu %', v_pessoas; end if;
  if v_pres_outras <> 0 then raise exception 'FALHOU: representante enxergou % presenças de outras instituições', v_pres_outras; end if;
  raise notice 'OK   RLS — representante consulta instituições, mas pessoas e presenças só da dele';

  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true); -- Carla
  select count(*) into v_pessoas from pessoa;
  if v_pessoas < 3 then raise exception 'FALHOU: diretoria deveria ver todas as pessoas'; end if;
  raise notice 'OK   RLS — diretoria enxerga todas as pessoas (%)', v_pessoas;
end $$;

-- ---------------------------------------------------------- guarda da instituição
do $$
declare v_n int;
begin
  begin
    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111112', true);

    update instituicao set telefone = '(42) 3000-0000' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FALHOU: representante não conseguiu atualizar o telefone da própria'; end if;
    raise notice 'OK   guarda — representante atualiza o contato da própria instituição';

    begin
      update instituicao set nome = 'Outro nome' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
      raise exception 'FALHOU: representante trocou o nome sem aprovação';
    exception when raise_exception then
      if sqlerrm not like '%ALTERACAO_EXIGE_APROVACAO%' then raise; end if;
    end;
    raise notice 'OK   guarda — nome da instituição ativa só muda por solicitação';

    begin
      update instituicao set status = 'inativa', data_saida = current_date
       where id = 'aaaaaaaa-0000-0000-0000-000000000001';
      raise exception 'FALHOU: representante mudou a situação da instituição';
    exception when raise_exception then
      if sqlerrm not like '%ALTERACAO_EXIGE_APROVACAO%' then raise; end if;
    end;
    raise notice 'OK   guarda — representante não muda a situação';

    update instituicao set telefone = '(42) 1111-1111' where id = 'aaaaaaaa-0000-0000-0000-000000000003';
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception 'FALHOU: representante atualizou OUTRA instituição'; end if;
    raise notice 'OK   RLS — atualizar outra instituição afeta zero linhas';

    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- Durante o preenchimento (rascunho), o representante preenche nome e CNPJ e
-- envia para análise; aprovar continua sendo da gestão.
do $$
begin
  begin
    update instituicao set status = 'rascunho', data_entrada = null
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';

    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111112', true);

    update instituicao set nome = 'Universidade Alfa (nome novo)', cnpj = '11222333000181'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    update instituicao set status = 'em_analise' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise notice 'OK   guarda — em rascunho o representante preenche tudo e envia para análise';

    begin
      update instituicao set status = 'ativa' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
      raise exception 'FALHOU: representante aprovou a própria entrada';
    exception when raise_exception then
      if sqlerrm not like '%ALTERACAO_EXIGE_APROVACAO%' then raise; end if;
    end;
    raise notice 'OK   guarda — representante não aprova a própria entrada';

    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- --------------------------------------------------------- pessoa e conta
do $$
begin
  begin
    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111114', true); -- Marina

    update pessoa set telefone = '(42) 99999-9999', autoriza_comunicacao = true
     where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise notice 'OK   pessoa — representante atualiza os próprios contatos e a autorização';

    begin
      update pessoa set nome = 'Outra Pessoa' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
      raise exception 'FALHOU: representante trocou o próprio nome';
    exception when raise_exception then
      if sqlerrm not like '%ALTERACAO_EXIGE_APROVACAO%' then raise; end if;
    end;

    begin
      update usuario set papel = 'admin' where id = '11111111-1111-1111-1111-111111111114';
      raise exception 'FALHOU: representante se promoveu a admin';
    exception when raise_exception then
      if sqlerrm not like '%SEM_PERMISSAO_CONTA%' then raise; end if;
    end;
    raise notice 'OK   conta — representante não se promove nem troca de instituição';

    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- --------------------------------------------------------------- documentos
do $$
begin
  begin
    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111112', true);

    insert into documento (nome, tipo, url_externa, instituicao_id, visibilidade, status_analise)
    values ('Ofício', 'oficio', 'https://exemplo.br/oficio.pdf',
            'aaaaaaaa-0000-0000-0000-000000000001', 'interno', 'em_analise');
    raise notice 'OK   documento — representante anexa à própria instituição (em análise)';

    -- Desde a 014: o que a instituição envia nasce em análise, nunca aprovado.
    begin
      insert into documento (nome, tipo, url_externa, instituicao_id, visibilidade)
      values ('Aprovado por conta própria', 'oficio', 'https://exemplo.br/x.pdf',
              'aaaaaaaa-0000-0000-0000-000000000001', 'interno');
      raise exception 'FALHOU: representante anexou documento já aprovado';
    exception when insufficient_privilege then null;
    end;
    raise notice 'OK   documento — representante não anexa documento já aprovado';

    begin
      insert into documento (nome, url_externa, instituicao_id)
      values ('Intruso', 'https://exemplo.br/x.pdf', 'aaaaaaaa-0000-0000-0000-000000000003');
      raise exception 'FALHOU: representante anexou documento a outra instituição';
    exception when insufficient_privilege then null;
    end;

    begin
      insert into documento (nome, url_externa, instituicao_id, visibilidade)
      values ('Público', 'https://exemplo.br/x.pdf', 'aaaaaaaa-0000-0000-0000-000000000001', 'publico');
      raise exception 'FALHOU: representante publicou documento no painel';
    exception when insufficient_privilege then null;
    end;
    raise notice 'OK   documento — nem em outra instituição, nem como público';

    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

do $$
begin
  begin
    -- Documento do Fórum sem dono só existe se for público.
    begin
      insert into documento (nome, url_externa, visibilidade) values ('Sem dono', 'https://x.br/a', 'interno');
      raise exception 'FALHOU: documento interno sem dono foi aceito';
    exception when check_violation then null;
    end;
    insert into documento (nome, tipo, url_externa, visibilidade)
    values ('Regimento Interno', 'regimento', 'https://exemplo.br/regimento.pdf', 'publico');
    raise notice 'OK   documento — Regimento do Fórum existe sem dono, desde que público';
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------------- solicitações
do $$
declare v_id uuid; v_n int;
begin
  begin
    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111112', true);

    insert into solicitacao (instituicao_id, tipo, dados, solicitado_por)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'alterar_dados',
            '{"campos": {"nome": "Universidade Alfa S.A."}}', usuario_atual_id())
    returning id into v_id;
    raise notice 'OK   solicitação — representante abre para a própria instituição';

    begin
      insert into solicitacao (instituicao_id, tipo, solicitado_por)
      values ('aaaaaaaa-0000-0000-0000-000000000003', 'novo_oficio', usuario_atual_id());
      raise exception 'FALHOU: representante abriu solicitação para outra instituição';
    exception when insufficient_privilege then null;
    end;

    -- Aprovar a própria: a política não deixa (status final tem que ser cancelada).
    begin
      update solicitacao set status = 'aprovada', analisado_em = now() where id = v_id;
      raise exception 'FALHOU: representante aprovou a própria solicitação';
    exception when insufficient_privilege then null;
    end;

    update solicitacao set status = 'cancelada' where id = v_id;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FALHOU: representante não conseguiu cancelar a própria'; end if;
    raise notice 'OK   solicitação — representante cancela, mas não aprova';

    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111114', true); -- Marina, mesma inst.
    select count(*) into v_n from solicitacao where id = v_id;
    if v_n <> 1 then raise exception 'FALHOU: outro representante da mesma instituição não vê a solicitação'; end if;

    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true); -- Carla
    select count(*) into v_n from solicitacao;
    if v_n = 0 then raise exception 'FALHOU: diretoria não enxerga solicitações'; end if;
    raise notice 'OK   solicitação — a instituição inteira e a diretoria enxergam';

    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------- titular e suplente
do $$
begin
  begin
    insert into pessoa (id, nome) values ('bbbbbbbb-0000-0000-0000-0000000000f1', 'Outro Titular');
    begin
      insert into vinculo (pessoa_id, instituicao_id, tipo_representacao)
      values ('bbbbbbbb-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'titular');
      raise exception 'FALHOU: dois titulares vigentes na mesma instituição';
    exception when unique_violation then null;
    end;
    insert into vinculo (pessoa_id, instituicao_id, tipo_representacao)
    values ('bbbbbbbb-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'suplente');
    raise notice 'OK   representação — um titular e um suplente vigentes por instituição';
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- --------------------------------------------------- reunião x evento
do $$
declare v_ev uuid; v_esperadas int; v_rasc int;
begin
  begin
    insert into reuniao (titulo, natureza, data, status, conta_participacao)
    values ('Palestra que não conta', 'evento', '2025-09-15', 'encerrada', false)
    returning id into v_ev;
    select count(*) into v_esperadas from vw_reuniao_esperada where reuniao_id = v_ev;
    if v_esperadas <> 0 then
      raise exception 'FALHOU: evento que não conta entrou no percentual oficial (% esperados)', v_esperadas;
    end if;
    raise notice 'OK   indicadores — atividade com conta_participacao = false não entra no percentual';

    insert into reuniao (titulo, data, status) values ('Rascunho da Diretoria', current_date, 'rascunho');
    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111112', true);
    select count(*) into v_rasc from reuniao where status = 'rascunho';
    if v_rasc <> 0 then raise exception 'FALHOU: representante enxergou reunião em rascunho'; end if;
    raise notice 'OK   RLS — reunião em rascunho é só da gestão';

    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------- check-in v2
do $$
declare v_token text; v_r record; v_q record;
begin
  begin
    insert into reuniao (titulo, data, status, permite_convidado, limite_participantes)
    values ('Check-in v2', current_date, 'agendada', false, 1)
    returning qr_token into v_token;

    begin
      perform * from checkin_registrar(v_token, null, 'Convidado Avulso');
      raise exception 'FALHOU: convidado entrou com permite_convidado = false';
    exception when raise_exception then
      if sqlerrm not like '%CONVIDADO_NAO_PERMITIDO%' then raise; end if;
    end;
    raise notice 'OK   check-in — convidado só entra quando a atividade permite';

    select * into v_q from checkin_quem_sou(v_token, 'bbbbbbbb-0000-0000-0000-000000000002');
    if v_q.nome <> 'Marina Gonçalves' or not v_q.pode_registrar or v_q.ja_registrado then
      raise exception 'FALHOU: checkin_quem_sou devolveu %', row_to_json(v_q);
    end if;

    select * into v_r from checkin_registrar(v_token, 'bbbbbbbb-0000-0000-0000-000000000002',
                                             p_modo => 'presencial', p_assinar => true, p_ip => '10.0.0.1');
    if not exists (select 1 from presenca where id = v_r.out_presenca_id
                    and assinado_em is not null and assinatura_ip = '10.0.0.1' and modo = 'presencial') then
      raise exception 'FALHOU: a assinatura simples não foi gravada';
    end if;
    raise notice 'OK   check-in — registra modo e assinatura simples (hora e IP)';

    begin
      perform * from checkin_registrar(v_token, 'bbbbbbbb-0000-0000-0000-000000000003');
      raise exception 'FALHOU: passou do limite de participantes';
    exception when raise_exception then
      if sqlerrm not like '%LIMITE_ATINGIDO%' then raise; end if;
    end;

    -- Quem já está dentro não é barrado pelo limite: só recebe o registro anterior.
    select * into v_r from checkin_registrar(v_token, 'bbbbbbbb-0000-0000-0000-000000000002');
    if not v_r.out_ja_existia then raise exception 'FALHOU: repetição deveria devolver o registro anterior'; end if;
    raise notice 'OK   check-in — limite de vagas barra quem chega depois de lotar';

    update reuniao set status = 'rascunho' where qr_token = v_token;
    begin
      perform * from checkin_reuniao(v_token);
      if found then raise exception 'FALHOU: rascunho apareceu no check-in público'; end if;
    end;
    raise notice 'OK   check-in — atividade em rascunho não existe para o QR';

    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------------ painel público
do $$
declare v_n int; v_ind jsonb; v_dir record;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '', true);

  select count(*) into v_n from instituicao;
  if v_n <> 0 then raise exception 'FALHOU: sem login a TABELA instituição ficou visível'; end if;

  select count(*) into v_n from publico_instituicoes();
  if v_n <> 3 then
    raise exception 'FALHOU: o painel deveria listar as 3 ativas que autorizaram, listou %', v_n;
  end if;
  if exists (select 1 from publico_instituicoes() where nome = 'Instituto Gama') then
    raise exception 'FALHOU: instituição em análise apareceu no painel público';
  end if;
  raise notice 'OK   painel — só instituição ativa que autorizou a divulgação aparece';

  select count(*) into v_n from publico_instituicoes(p_tipo => 5::smallint);
  if v_n <> 1 then raise exception 'FALHOU: filtro por tipo devolveu %', v_n; end if;
  raise notice 'OK   painel — filtro por tipo funciona';

  v_ind := publico_indicadores();
  if (v_ind ->> 'instituicoesIntegrantes')::int < 3 then
    raise exception 'FALHOU: indicadores públicos vieram vazios: %', v_ind;
  end if;
  if v_ind::text ~* 'cpf|email|telefone' then
    raise exception 'FALHOU: indicador público carrega dado pessoal';
  end if;
  raise notice 'OK   painel — indicadores gerais sem login e sem dado pessoal';

  select * into v_dir from publico_diretoria() limit 1;
  if v_dir.nome <> 'Carlos Antunes' or v_dir.cargo_forum <> 'Presidente' then
    raise exception 'FALHOU: composição da Diretoria veio %', row_to_json(v_dir);
  end if;
  raise notice 'OK   painel — composição da Diretoria (nome, cargo e instituição)';

  select count(*) into v_n from publico_agenda('2026-01-01');
  if v_n < 2 then raise exception 'FALHOU: agenda pública deveria ter a 68ª reunião e o workshop (%)', v_n; end if;
  raise notice 'OK   painel — calendário mostra reuniões e eventos públicos';

  if publico_configuracao() ? 'linktree' is not true then
    raise exception 'FALHOU: configuração pública sem a chave linktree';
  end if;
  raise notice 'OK   painel — links oficiais vêm da configuração';
end $$;
