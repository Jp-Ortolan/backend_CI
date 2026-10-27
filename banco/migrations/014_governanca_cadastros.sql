-- =============================================================================
-- 014 — Governança dos cadastros  ·  feature/governanca-cadastros
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- O front publicou (10/10 e 26/10) as telas do Fórum consumindo o contrato
-- /api/governanca. Esta migration traz o que esse contrato exige e o banco
-- ainda não tinha:
--
--   1. versao_registro — controle de concorrência otimista: quem edita manda a
--      versão que leu; se outra pessoa salvou antes, a gravação é recusada (409)
--      em vez de sobrescrever em silêncio.
--   2. Documento em análise — o que a instituição envia (logo, ofício, termo)
--      só vale depois que a Diretoria aprova. A logo só vai para o painel
--      público aprovada.
--   3. Observações internas como histórico (só se acrescenta, nunca se edita).
--   4. Preferências de e-mail por conta.
--   5. Campos de texto que as telas usam: endereço completo da instituição;
--      vertente do representante; ata, encaminhamentos em texto e imagem de
--      divulgação da atividade.
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — versao_registro
-- =============================================================================

alter table usuario     add column versao_registro integer not null default 1;
alter table instituicao add column versao_registro integer not null default 1;
alter table vinculo     add column versao_registro integer not null default 1;
alter table reuniao     add column versao_registro integer not null default 1;
alter table solicitacao add column versao_registro integer not null default 1;
alter table encaminhamento add column versao_registro integer not null default 1;

-- Sobe a versão a cada mudança de verdade. Campos que mudam sozinhos (último
-- login, updated_at, coluna gerada) não contam: senão o login de alguém faria
-- a edição do admin sobre aquela conta dar conflito.
create or replace function tg_versao_registro() returns trigger
language plpgsql as $$
declare
  ignorar text[] := array['versao_registro', 'updated_at', 'ultimo_login', 'nome_busca'];
begin
  if (to_jsonb(new) - ignorar) is distinct from (to_jsonb(old) - ignorar) then
    new.versao_registro := old.versao_registro + 1;
  else
    new.versao_registro := old.versao_registro;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['usuario', 'instituicao', 'vinculo', 'reuniao', 'solicitacao', 'encaminhamento']
  loop
    execute format(
      'create trigger %I_versao before update on %I
         for each row execute function tg_versao_registro()', t, t);
  end loop;
end $$;

-- =============================================================================
-- PARTE 2 — Documento em análise
-- =============================================================================

create type status_documento as enum ('em_analise', 'aprovado', 'recusado');

alter table documento
  add column status_analise status_documento not null default 'aprovado';

comment on column documento.status_analise is
  'O que a instituição envia nasce em_analise e só vale depois de aprovado pela '
  'Diretoria (solicitação aprovacao_documento). O que a gestão envia nasce aprovado.';

-- O representante só anexa documento EM ANÁLISE: nem pela API direta ele
-- consegue pôr no ar um ofício ou uma logo sem a Diretoria ver.
drop policy documento_inserir on documento;
create policy documento_inserir on documento for insert
  with check (
    eh_gestao()
    or (papel_atual() = 'representante'
        and instituicao_id = instituicao_atual_id()
        and reuniao_id is null
        and visibilidade = 'interno'
        and status_analise = 'em_analise')
  );

-- A logo trocava direto pelo representante (estava entre os campos livres da
-- guarda da 008). Agora ela só muda pela aprovação: sai da lista.
create or replace function tg_instituicao_guarda_representante() returns trigger
language plpgsql as $$
declare
  livres text[] := array[
    'email', 'telefone', 'site',
    'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'complemento',
    'descricao', 'redes_sociais', 'contatos_comunicacao',
    'autoriza_divulgacao', 'autoriza_logo',
    'updated_at', 'updated_by', 'nome_busca', 'versao_registro'];
  da_gestao text[] := array[
    'status', 'data_entrada', 'data_saida', 'observacoes',
    'motivo_saida', 'substituida_por_id', 'created_by', 'created_at',
    'logo_documento_id'];
  preenchendo boolean;
begin
  if papel_atual() is distinct from 'representante' then
    return new;
  end if;

  preenchendo := old.status in ('rascunho', 'aguardando_documentos', 'ajustes_solicitados');

  if new.status is distinct from old.status then
    if not (
         (preenchendo and new.status = 'em_analise')
      or (old.status = 'rascunho' and new.status = 'aguardando_documentos')
    ) then
      raise exception 'ALTERACAO_EXIGE_APROVACAO'
        using hint = 'A situação da instituição é decidida pela Diretoria.';
    end if;
  end if;

  if preenchendo then
    if exists (
         select 1 from unnest(da_gestao) c
          where c <> 'status'
            and (to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c))
    then
      raise exception 'ALTERACAO_EXIGE_APROVACAO'
        using hint = 'Datas, logo e observações internas são decididas pela Diretoria.';
    end if;
  else
    if (to_jsonb(new) - livres) is distinct from (to_jsonb(old) - livres) then
      raise exception 'ALTERACAO_EXIGE_APROVACAO'
        using hint = 'Nome, CNPJ, classificação, logo e situação mudam por solicitação.';
    end if;
  end if;

  return new;
end $$;

-- Painel público: a logo só sai aprovada.
create or replace function publico_logo(p_instituicao_id uuid)
returns table (mime_type text, conteudo bytea, atualizado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select d.mime_type, c.conteudo, d.created_at
    from instituicao i
    join documento d          on d.id = i.logo_documento_id
    join documento_conteudo c on c.documento_id = d.id
   where i.id = p_instituicao_id
     and i.status = 'ativa'
     and i.autoriza_divulgacao
     and i.autoriza_logo
     and d.status_analise = 'aprovado'
     and d.mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
$$;

-- =============================================================================
-- PARTE 3 — Observações internas
-- =============================================================================

create table instituicao_observacao (
  id             uuid primary key default gen_random_uuid(),
  instituicao_id uuid not null references instituicao(id) on delete cascade,
  texto          text not null check (char_length(texto) between 1 and 5000),
  autor_id       uuid references usuario(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index instituicao_observacao_idx on instituicao_observacao (instituicao_id, created_at desc);

comment on table instituicao_observacao is
  'Observações internas da gestão sobre a instituição. Só se acrescenta: não há '
  'política de UPDATE nem de DELETE. Nunca sai para o representante nem para o público.';

alter table instituicao_observacao enable row level security;
create policy instituicao_observacao_ler on instituicao_observacao for select using (eh_gestao());
create policy instituicao_observacao_inserir on instituicao_observacao for insert
  with check (eh_gestao() and autor_id = usuario_atual_id());
grant select, insert on instituicao_observacao to app_web;

create trigger instituicao_observacao_auditoria after insert on instituicao_observacao
  for each row execute function tg_auditar();

-- =============================================================================
-- PARTE 4 — Preferências de e-mail
-- =============================================================================

alter table usuario
  add column preferencias jsonb not null default
    '{"emailConvocacoes": true, "emailSolicitacoes": true, "emailEncaminhamentos": true}'::jsonb;

alter table usuario add constraint usuario_preferencias_objeto
  check (jsonb_typeof(preferencias) = 'object');

-- =============================================================================
-- PARTE 5 — Campos de texto das telas
-- =============================================================================

alter table instituicao add column endereco_texto text;
comment on column instituicao.endereco_texto is
  'Endereço completo digitado numa linha só (tela de governança). Quando vazio, '
  'a API monta o texto a partir de logradouro, número, bairro, cidade, UF e CEP.';

alter table vinculo add column vertente_id smallint references vertente(id) on delete set null;

alter table reuniao
  add column ata_texto             text,
  add column encaminhamentos_texto text,
  add column imagem_url            text;

alter table reuniao
  add constraint reuniao_imagem_http check (imagem_url is null or imagem_url ~* '^https?://');

commit;
