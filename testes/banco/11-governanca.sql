-- =============================================================================
-- TESTES DO CONTRATO /api/governanca — migrations 013 a 015
--
-- Versão de registro, documento em análise, observações internas,
-- convocação (guarda do representante), idempotência e check-in assinado.
-- Usuários do seed: ...111 Ana (admin), ...113 Carla (diretoria),
-- ...114 Marina (representante da Alfa, ligada à pessoa Marina).
-- Blocos que mudam dado terminam com 'desfazer'.
-- =============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------- versao_registro
do $$
declare v1 int; v2 int; v3 int;
begin
  begin
    select versao_registro into v1 from instituicao where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    update instituicao set telefone = '(42) 9999-0000' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    select versao_registro into v2 from instituicao where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    update instituicao set telefone = '(42) 9999-0000' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    select versao_registro into v3 from instituicao where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if v2 <> v1 + 1 then raise exception 'FALHOU: versão não subiu (% -> %)', v1, v2; end if;
    if v3 <> v2 then raise exception 'FALHOU: update sem mudança subiu a versão'; end if;
    raise notice 'OK   versao_registro — sobe só com mudança de verdade';
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- ---------------------------------------------- documento da instituição em análise
do $$
begin
  begin
    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111114', true); -- Marina
    begin
      insert into documento (nome, tipo, url_externa, instituicao_id, enviado_por, status_analise)
      values ('Ofício', 'oficio', 'https://exemplo.br/o.pdf', 'aaaaaaaa-0000-0000-0000-000000000001',
              '11111111-1111-1111-1111-111111111114', 'aprovado');
      raise exception 'FALHOU: representante gravou documento já aprovado';
    exception when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then raise; end if;
    end;
    raise notice 'OK   documento — o que a instituição envia nasce em análise';

    begin
      insert into instituicao_observacao (instituicao_id, texto, autor_id)
      values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', '11111111-1111-1111-1111-111111111114');
      raise exception 'FALHOU: representante gravou observação interna';
    exception when others then
      if sqlerrm not like '%row-level security%' then raise; end if;
    end;
    if exists (select 1 from instituicao_observacao) then
      raise exception 'FALHOU: representante leu observação interna';
    end if;
    raise notice 'OK   observações internas — fora do alcance do representante';
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------------- convocação
do $$
declare v_id uuid; v_n int;
begin
  begin
    insert into convocacao (reuniao_id, instituicao_id, assunto, mensagem)
    values ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Convocação', 'Venham')
    returning id into v_id;
    insert into convocacao (reuniao_id, instituicao_id, assunto, mensagem)
    values ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003', 'Convocação', 'Venham');

    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111114', true); -- Marina, Alfa
    select count(*) into v_n from convocacao where reuniao_id = 'dddddddd-0000-0000-0000-000000000004';
    if v_n <> 1 then raise exception 'FALHOU: representante viu % convocações (só a dele)', v_n; end if;

    begin
      update convocacao set mensagem = 'Outra' where id = v_id;
      raise exception 'FALHOU: representante mudou a mensagem da convocação';
    exception when raise_exception then
      if sqlerrm not like '%SEM_PERMISSAO_CONVOCACAO%' then raise; end if;
    end;

    begin
      update convocacao set resposta = 'recusada', justificativa = null, respondida_em = now(),
             respondida_por = '11111111-1111-1111-1111-111111111114' where id = v_id;
      raise exception 'FALHOU: recusa sem justificativa passou';
    exception when check_violation then null;
    end;

    update convocacao set resposta = 'confirmada', representante_pessoa_id = 'bbbbbbbb-0000-0000-0000-000000000002',
           respondida_em = now(), respondida_por = '11111111-1111-1111-1111-111111111114'
     where id = v_id;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FALHOU: representante não respondeu à convocação'; end if;
    raise notice 'OK   convocação — instituição só vê a dela e só responde';
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------------- idempotência
do $$
declare v_n int;
begin
  begin
    set local role app_web;
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true); -- Carla
    insert into operacao_idempotente (chave, usuario_id, escopo, hash)
    values ('00000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111113', 'x', 'h');
    perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111111', true); -- Ana
    select count(*) into v_n from operacao_idempotente;
    if v_n <> 0 then raise exception 'FALHOU: chave de operação de outra conta ficou visível'; end if;
    raise notice 'OK   idempotência — a chave é de quem a usou';
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------ check-in assinado
do $$
declare v_token text; v record;
begin
  begin
    update reuniao set status = 'agendada', data = current_date, checkin_abre_em = null, checkin_fecha_em = null,
                       permite_convidado = true, limite_participantes = null
     where id = 'dddddddd-0000-0000-0000-000000000004'
    returning qr_token into v_token;

    set local role app_web;
    perform set_config('app.usuario_id', '', true);
    begin
      perform * from checkin_registrar_assinado(v_token, null, 'Convidado Teste', 'c@x.br', null, null, null, '');
      raise exception 'FALHOU: check-in sem assinatura passou';
    exception when raise_exception then
      if sqlerrm not like '%ASSINATURA_OBRIGATORIA%' then raise; end if;
    end;
    select * into v from checkin_registrar_assinado(v_token, null, 'Convidado Teste', 'c@x.br', null, null, '1.2.3.4', 'Convidado Teste');
    if v.out_tipo <> 'convidado' then raise exception 'FALHOU: tipo %', v.out_tipo; end if;
    begin
      perform * from checkin_registrar_assinado(v_token, null, 'Outro Nome', 'C@X.BR', null, null, null, 'Outro Nome');
      raise exception 'FALHOU: convidado com o mesmo e-mail registrou duas vezes';
    exception when raise_exception then
      if sqlerrm not like '%PRESENCA_JA_REGISTRADA%' then raise; end if;
    end;
    reset role;
    if (select assinatura_nome from presenca where id = v.out_presenca_id) <> 'Convidado Teste' then
      raise exception 'FALHOU: assinatura não gravada';
    end if;
    raise notice 'OK   check-in — assinatura obrigatória, gravada, e convidado não duplica';
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;
end $$;
