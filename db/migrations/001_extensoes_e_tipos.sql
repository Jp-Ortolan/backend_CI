-- =============================================================================
-- 001 — Extensões e tipos
-- Sistema de Gestão do Ecossistema de Inovação · PostgreSQL 15+ (Railway)
--
-- Este conjunto de migrations roda em QUALQUER PostgreSQL. Não depende de
-- extensão proprietária nem de schema de plataforma — o banco local, o de
-- homologação e o de produção são o mesmo produto.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid(), gen_random_bytes()
create extension if not exists unaccent;   -- busca ignorando acento
create extension if not exists pg_trgm;    -- busca aproximada por nome (check-in)

-- unaccent() não é IMMUTABLE e por isso não pode ir direto numa coluna gerada.
create or replace function imutavel_unaccent(text)
  returns text language sql immutable strict parallel safe
as $$ select unaccent('unaccent', $1) $$;

create type status_instituicao as enum
  ('em_processo_entrada', 'ativa', 'em_processo_saida', 'inativa');
create type status_vinculo    as enum ('ativo', 'encerrado');
create type status_reuniao    as enum ('agendada', 'em_andamento', 'encerrada', 'cancelada');
create type tipo_participante as enum ('representante', 'convidado');
create type status_presenca   as enum ('presente', 'ausente', 'justificado');
create type origem_presenca   as enum ('qrcode', 'manual', 'importacao');
create type papel_usuario     as enum ('admin', 'gestor', 'leitura');
