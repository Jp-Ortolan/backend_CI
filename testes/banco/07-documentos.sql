-- =============================================================================
-- TESTES DA MIGRATION 004 — documentos
--
-- Pré-requisito: migrations 001 a 004 + seed aplicados.
-- Uso: psql -v ON_ERROR_STOP=1 -f testes/banco/07-documentos.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ------------------------------------------------- arquivo OU link, nunca os dois
do $$
begin
  begin
    insert into documento (nome, instituicao_id, storage_path, url_externa)
    values ('Os dois', 'aaaaaaaa-0000-0000-0000-000000000001',
            'instituicao/x/y.pdf', 'https://drive.google.com/x');
    raise exception 'FALHOU: o banco aceitou documento com arquivo E link';
  exception when check_violation then
    raise notice 'OK   documento — arquivo e link ao mesmo tempo foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into documento (nome, instituicao_id)
    values ('Nem um nem outro', 'aaaaaaaa-0000-0000-0000-000000000001');
    raise exception 'FALHOU: o banco aceitou documento sem arquivo e sem link';
  exception when check_violation then
    raise notice 'OK   documento — sem arquivo e sem link foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    -- javascript: num campo que a tela transforma em href é execução de script
    -- no navegador de quem clica.
    insert into documento (nome, instituicao_id, url_externa)
    values ('Link malicioso', 'aaaaaaaa-0000-0000-0000-000000000001',
            'javascript:alert(document.cookie)');
    raise exception 'FALHOU: o banco aceitou um link que não é http';
  exception when check_violation then
    raise notice 'OK   documento — link fora de http(s) foi recusado';
  end;
end $$;

-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into documento (nome, instituicao_id, storage_path, checksum_sha256)
    values ('Checksum torto', 'aaaaaaaa-0000-0000-0000-000000000001',
            'instituicao/x/z.pdf', 'NAO-EH-HEX');
    raise exception 'FALHOU: o banco aceitou checksum que não é hex de 64';
  exception when check_violation then
    raise notice 'OK   documento — checksum fora do formato foi recusado';
  end;
end $$;

-- ------------------------------------------------------------------ conteúdo
do $$
declare v_doc uuid; v_bytes bytea; v_lido bytea;
begin
  v_bytes := decode('255044462d312e370a2578787800', 'hex');  -- "%PDF-1.7" + binário

  insert into documento (nome, instituicao_id, storage_path, mime_type,
                         tamanho_bytes, checksum_sha256)
  values ('Relatorio.pdf', 'aaaaaaaa-0000-0000-0000-000000000001',
          'instituicao/aaaa/rel.pdf', 'application/pdf',
          length(v_bytes), encode(sha256(v_bytes), 'hex'))
  returning id into v_doc;

  insert into documento_conteudo (documento_id, conteudo) values (v_doc, v_bytes);

  select conteudo into v_lido from documento_conteudo where documento_id = v_doc;
  if v_lido <> v_bytes then
    raise exception 'FALHOU: os bytes lidos não são os mesmos que foram gravados';
  end if;
  raise notice 'OK   conteúdo — os bytes voltam idênticos do banco';

  -- O ponto da tabela separada: a listagem não pode arrastar o blob junto.
  if exists (
    select 1 from information_schema.columns
     where table_name = 'documento' and data_type = 'bytea'
  ) then
    raise exception 'FALHOU: documento tem coluna binária — a listagem traria os bytes';
  end if;
  raise notice 'OK   conteúdo — documento não tem coluna binária; listagem fica leve';

  -- Apagar o documento leva o conteúdo junto: nada de blob órfão ocupando banco.
  delete from documento where id = v_doc;
  if exists (select 1 from documento_conteudo where documento_id = v_doc) then
    raise exception 'FALHOU: o conteúdo ficou órfão depois de apagar o documento';
  end if;
  raise notice 'OK   conteúdo — apagar o documento apaga os bytes junto';
end $$;

-- --------------------------------------- instituição com documento é protegida
do $$
declare v_inst uuid; v_doc uuid;
begin
  -- Instituição SEM vínculo e SEM presença: antes da 004 ela seria apagada e
  -- levaria os documentos junto, por cascade, sem erro nenhum.
  insert into instituicao (nome, cnpj, status)
  values ('So Documentos', '88888888888888', 'em_processo_entrada')
  returning id into v_inst;

  insert into documento (nome, instituicao_id, storage_path)
  values ('Anexo.pdf', v_inst, 'instituicao/sodoc/anexo.pdf')
  returning id into v_doc;

  begin
    delete from instituicao where id = v_inst;
    raise exception 'FALHOU: instituição com documentos foi excluída';
  exception when raise_exception then
    if sqlerrm not like '%INSTITUICAO_COM_DOCUMENTO%' then raise; end if;
    raise notice 'OK   exclusão — instituição com documentos foi protegida';
  end;

  if not exists (select 1 from documento where id = v_doc) then
    raise exception 'FALHOU: o documento sumiu na tentativa de exclusão';
  end if;
  raise notice 'OK   exclusão — o documento sobreviveu à tentativa';

  -- limpeza
  delete from documento where id = v_doc;
  delete from instituicao where id = v_inst;
end $$;

-- --------------------------------------------- reunião com documento protegida
do $$
declare v_reuniao uuid; v_doc uuid;
begin
  insert into reuniao (titulo, data) values ('Com anexo', current_date + 40)
  returning id into v_reuniao;

  insert into documento (nome, reuniao_id, storage_path)
  values ('Ata.pdf', v_reuniao, 'reuniao/comanexo/ata.pdf')
  returning id into v_doc;

  begin
    delete from reuniao where id = v_reuniao;
    raise exception 'FALHOU: reunião com documentos foi excluída';
  exception when raise_exception then
    if sqlerrm not like '%REUNIAO_COM_DOCUMENTO%' then raise; end if;
    raise notice 'OK   exclusão — reunião com documentos foi protegida (003)';
  end;

  delete from documento where id = v_doc;
  delete from reuniao where id = v_reuniao;
end $$;

-- --------------------------------------------------------------- RLS
do $$
declare v_linhas int;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '', true);

  select count(*) into v_linhas from documento_conteudo;
  if v_linhas <> 0 then
    raise exception 'FALHOU: o conteúdo dos documentos ficou legível sem usuário (% linhas)',
      v_linhas;
  end if;
  raise notice 'OK   RLS — conteúdo não é legível sem usuário declarado';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare v_doc uuid; v_apagou int;
begin
  insert into documento (nome, instituicao_id, storage_path)
  values ('Para gestor tentar', 'aaaaaaaa-0000-0000-0000-000000000001',
          'instituicao/aaaa/tentativa.pdf')
  returning id into v_doc;

  set local role app_web;
  -- Carla é gestora no seed.
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true);

  delete from documento where id = v_doc;
  get diagnostics v_apagou = row_count;

  reset role;

  -- A armadilha do projeto: DELETE sem política não levanta erro, só afeta
  -- zero linhas. O teste confere o EFEITO.
  if v_apagou <> 0 or not exists (select 1 from documento where id = v_doc) then
    raise exception 'FALHOU: gestor conseguiu excluir documento (% linhas)', v_apagou;
  end if;
  raise notice 'OK   RLS — gestor não exclui documento, e o delete não levanta erro';

  delete from documento where id = v_doc;
end $$;

do $$ begin raise notice ''; raise notice
  '== 07-documentos: todos os testes passaram =='; end $$;
