-- =============================================================================
-- 008 — Funções de autenticação
--
-- As tabelas sessao e token_recuperacao ficam fechadas pelo RLS: durante o
-- login ainda não existe usuário declarado na transação, então não haveria como
-- uma política liberar o acesso sem abrir demais.
--
-- A saída é concentrar essas operações em funções SECURITY DEFINER — elas
-- rodam com o privilégio do dono, mas só fazem exatamente o que está escrito
-- aqui. É pouca superfície e é auditável, ao contrário de uma chave que ignora
-- todas as regras do sistema.
--
-- O hash da senha (Argon2id) e o hash do token são calculados na aplicação.
-- O banco nunca vê a senha nem o token em texto puro.
-- =============================================================================

-- ------------------------------------------------------------------- login
create or replace function auth_credenciais(p_email text)
returns table (id uuid, nome text, email text, senha_hash text,
               papel papel_usuario, ativo boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.nome, u.email, u.senha_hash, u.papel, u.ativo
  from usuario u
  where u.email = lower(trim(p_email))
$$;

create or replace function auth_criar_sessao(
  p_usuario_id uuid, p_token_hash text, p_expira_em timestamptz,
  p_ip text default null, p_agente text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into sessao (token_hash, usuario_id, expira_em, ip, agente)
  values (p_token_hash, p_usuario_id, p_expira_em, p_ip, p_agente);

  update usuario set ultimo_login = now() where id = p_usuario_id;
end $$;

create or replace function auth_ler_sessao(p_token_hash text)
returns table (id uuid, nome text, email text, papel papel_usuario, ativo boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.nome, u.email, u.papel, u.ativo
  from sessao s
  join usuario u on u.id = s.usuario_id
  where s.token_hash = p_token_hash
    and s.expira_em > now()
    and u.ativo
$$;

create or replace function auth_encerrar_sessao(p_token_hash text)
returns void
language sql security definer set search_path = public as $$
  delete from sessao where token_hash = p_token_hash
$$;

-- --------------------------------------------------- recuperação de senha
-- Devolve sempre void, exista ou não a conta: quem chama não consegue usar
-- este endpoint para descobrir quais e-mails estão cadastrados.
create or replace function auth_criar_token_recuperacao(
  p_email text, p_token_hash text, p_expira_em timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from usuario where email = lower(trim(p_email)) and ativo;
  if v_id is null then return; end if;

  insert into token_recuperacao (token_hash, usuario_id, expira_em)
  values (p_token_hash, v_id, p_expira_em);
end $$;

/* Consome o token e devolve o dono. Um token só serve uma vez: a marcação de
   uso acontece na mesma instrução que o valida, então duas requisições
   simultâneas não conseguem usá-lo duas vezes. */
create or replace function auth_usar_token_recuperacao(p_token_hash text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update token_recuperacao
     set usado_em = now()
   where token_hash = p_token_hash
     and usado_em is null
     and expira_em > now()
  returning usuario_id into v_id;

  return v_id;
end $$;

create or replace function auth_definir_senha(p_usuario_id uuid, p_senha_hash text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update usuario set senha_hash = p_senha_hash where id = p_usuario_id;
  -- Trocar a senha derruba todas as sessões abertas daquele usuário.
  delete from sessao where usuario_id = p_usuario_id;
end $$;

grant execute on function
  auth_credenciais(text),
  auth_criar_sessao(uuid, text, timestamptz, text, text),
  auth_ler_sessao(text),
  auth_encerrar_sessao(text),
  auth_criar_token_recuperacao(text, text, timestamptz),
  auth_usar_token_recuperacao(text),
  auth_definir_senha(uuid, text)
to app_web;
