-- =============================================================================
-- STUB DO SUPABASE PARA RODAR AS MIGRATIONS NUM POSTGRES COMUM
--
-- No Supabase, o schema "auth" e a função auth.uid() são nativos.
-- Num Postgres instalado na máquina (ou no runner do CI) eles não existem e as
-- migrations de RLS e do trigger de novo usuário quebram.
--
-- NÃO rode este arquivo num projeto Supabase de verdade.
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists auth;

-- Versão mínima de auth.users, só com o que as nossas migrations usam.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- No Supabase devolve o usuário autenticado. Local devolve nulo;
-- para testar RLS, troque o corpo por um id fixo.
create or replace function auth.uid() returns uuid
  language sql stable
as $$ select null::uuid $$;

comment on schema auth is 'STUB LOCAL — no Supabase este schema é nativo.';
