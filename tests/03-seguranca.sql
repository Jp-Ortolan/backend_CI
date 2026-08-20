-- =============================================================================
-- TESTES DE CONTROLE DE ACESSO
--
-- Aqui o teste assume a identidade do papel "app_web" — o mesmo que a aplicação
-- usa em produção — e confere que o banco impõe a matriz de permissões mesmo
-- que a aplicação peça algo errado.
--
-- Uso: psql -v ON_ERROR_STOP=1 -f tests/03-seguranca.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Sem usuário declarado na transação, não se enxerga nada.
do $$
declare visiveis int;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '', true);
  select count(*) into visiveis from instituicao;
  if visiveis <> 0 then
    raise exception 'FALHOU RNF15: sem sessão, app_web enxergou % instituições', visiveis;
  end if;
  raise notice 'OK   RNF15 — sem usuário declarado, o banco não devolve nada';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare visiveis int; p papel_usuario;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into visiveis from instituicao;
  select papel_atual() into p;
  if visiveis = 0 then raise exception 'FALHOU: admin não enxergou instituições'; end if;
  if p <> 'admin' then raise exception 'FALHOU: papel_atual devolveu % para a Ana', p; end if;
  raise notice 'OK   RF03 — administrador enxerga % instituições', visiveis;
end $$;

-- ---------------------------------------------------------------------------
-- Perfil de consulta não escreve.
do $$
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111112', true);
  begin
    insert into instituicao (nome) values ('Tentativa do perfil leitura');
    raise exception 'FALHOU RF03: perfil de consulta conseguiu inserir instituição';
  exception when insufficient_privilege then
    raise notice 'OK   RF03 — perfil de consulta foi impedido de inserir';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Gestor escreve, mas não exclui.
do $$
declare novo uuid;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true);

  insert into instituicao (nome, cnpj) values ('Instituição do Gestor', '99999999999999')
  returning id into novo;
  raise notice 'OK   RF03 — gestor conseguiu inserir instituição';

  update instituicao set cidade = 'Campo Grande' where id = novo;
  raise notice 'OK   RF03 — gestor conseguiu editar instituição';

  -- Atenção ao comportamento do PostgreSQL: quando falta política de INSERT, ele
  -- levanta erro; quando falta a de DELETE ou UPDATE, ele apenas NÃO ENXERGA a
  -- linha e apaga zero registros, em silêncio. Por isso aqui se confere o efeito,
  -- não a exceção — é o que realmente importa: a linha continua lá.
  delete from instituicao where id = novo;
  if not exists (select 1 from instituicao where id = novo) then
    raise exception 'FALHOU RF03: gestor conseguiu EXCLUIR instituição';
  end if;
  raise notice 'OK   RF03 — exclusão feita por gestor não removeu nada (linha intacta)';

  -- E o administrador consegue, para provar que a política existe e funciona.
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111111', true);
  delete from instituicao where id = novo;
  if exists (select 1 from instituicao where id = novo) then
    raise exception 'FALHOU RF03: administrador NÃO conseguiu excluir';
  end if;
  raise notice 'OK   RF03 — administrador conseguiu excluir';
end $$;

-- ---------------------------------------------------------------------------
-- Só administrador administra usuários.
do $$
declare visiveis int;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111113', true);
  select count(*) into visiveis from usuario;
  if visiveis <> 1 then
    raise exception 'FALHOU RF03: gestor enxergou % usuários (deveria ver só o próprio)', visiveis;
  end if;
  raise notice 'OK   RF03 — gestor enxerga apenas o próprio cadastro de usuário';
end $$;

-- ---------------------------------------------------------------------------
-- Tabelas de sessão e token ficam fechadas ao acesso direto.
do $$
declare visiveis int;
begin
  set local role app_web;
  perform set_config('app.usuario_id', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into visiveis from sessao;
  if visiveis <> 0 then
    raise exception 'FALHOU: sessões acessíveis por consulta direta (% linhas)', visiveis;
  end if;
  raise notice 'OK   sessão — tabela fechada ao acesso direto, só as funções entram';
end $$;

\echo ''
\echo '== 03-seguranca: todos os testes passaram =='
