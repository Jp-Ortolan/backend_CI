-- =============================================================================
-- 004 — Conteúdo dos documentos  ·  Bloco C
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- ONDE OS ARQUIVOS FICAM — a decisão que estava em aberto
--
-- A 001 já modelava o METADADO do documento (nome, mime, tamanho,
-- storage_path), assumindo que o arquivo moraria num serviço de armazenamento.
-- Esse serviço nunca foi contratado, e contratar agora dependeria do DevOps,
-- que é justamente o gargalo do projeto desde 20/08.
--
-- A escolha aqui é guardar os bytes no próprio PostgreSQL, por três motivos:
--   1. funciona hoje, sem conta nova, sem credencial nova, sem DevOps;
--   2. o backup do banco já leva os arquivos junto — com S3 seriam dois
--      backups, e o segundo é o que todo mundo esquece de configurar;
--   3. o volume é pequeno: relatórios de visitação e recibos, alguns MB cada.
--
-- O preço: isso não escala para milhares de arquivos grandes. Por isso os bytes
-- ficam em TABELA SEPARADA, e `storage_path` continua sendo a chave lógica do
-- arquivo. Migrar para S3/R2 depois é: subir cada blob para o caminho que já
-- está gravado em storage_path, trocar o adaptador em
-- src/infraestrutura/armazenamento/, e apagar esta tabela. Nenhuma outra parte
-- do sistema precisa saber.
--
-- POR QUE TABELA SEPARADA, E NÃO UMA COLUNA bytea EM documento
-- `select * from documento` acontece em toda listagem — na aba de documentos da
-- instituição, no detalhe da reunião. Com os bytes na mesma linha, cada
-- listagem arrastaria megabytes do banco para a aplicação sem ninguém pedir.
-- Separado, o blob só sai do banco quando alguém clica em baixar.
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — Metadados que faltavam
-- =============================================================================

alter table documento
  add column checksum_sha256 char(64),
  add column url_externa     text;

-- storage_path deixa de ser obrigatório: documento que é só um link para o
-- Drive não tem arquivo nenhum guardado aqui.
alter table documento alter column storage_path drop not null;

alter table documento
  add constraint documento_checksum_hex
    check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),

  -- Ou é arquivo guardado, ou é link externo. Nunca os dois, nunca nenhum:
  -- os dois deixaria ambíguo o que o botão "Baixar" faz, e nenhum seria uma
  -- linha de documento que não aponta para documento nenhum.
  add constraint documento_arquivo_ou_link
    check ((storage_path is not null) <> (url_externa is not null)),

  -- Link tem que ser http(s). Sem isso, `javascript:...` num campo que a tela
  -- transforma em href vira execução de script no navegador de quem clica.
  add constraint documento_link_http
    check (url_externa is null or url_externa ~* '^https?://');

comment on column documento.storage_path is
  'Chave lógica do arquivo, ex: instituicao/<uuid>/<uuid>-relatorio.pdf. '
  'Hoje os bytes ficam em documento_conteudo; ao migrar para S3/R2 este mesmo '
  'caminho vira a chave do objeto no bucket.';

comment on column documento.url_externa is
  'Para o documento que mora fora do sistema (Drive, site da instituição). '
  'Exclusivo com storage_path.';

comment on column documento.checksum_sha256 is
  'SHA-256 do conteúdo. Serve para conferir integridade depois da migração '
  'para outro armazenamento e para detectar reenvio do mesmo arquivo.';

-- =============================================================================
-- PARTE 2 — Os bytes
-- =============================================================================

create table documento_conteudo (
  documento_id uuid primary key references documento(id) on delete cascade,
  conteudo     bytea not null,
  created_at   timestamptz not null default now()
);

comment on table documento_conteudo is
  'Conteúdo binário dos documentos. Tabela separada de propósito: listagem de '
  'documento nunca deve trazer o blob junto. Ao migrar para armazenamento '
  'externo, esta tabela é esvaziada e removida.';

-- =============================================================================
-- PARTE 3 — Instituição com documentos também não se exclui
--
-- A 002 protegeu instituição com presença e com vínculo, mas esqueceu o
-- documento — e documento.instituicao_id é "on delete cascade". Uma instituição
-- só com documentos (sem vínculo e sem presença) ainda podia ser apagada,
-- levando os arquivos junto, em silêncio. Mesmo buraco que a 003 fechou na
-- reunião.
-- =============================================================================

create or replace function tg_instituicao_protege_historico() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from presenca where instituicao_id = old.id) then
    raise exception 'INSTITUICAO_COM_HISTORICO'
      using hint = 'Há presenças registradas. Desative a instituição '
                   '(status = inativa) em vez de excluir.';
  end if;

  if exists (select 1 from vinculo where instituicao_id = old.id) then
    raise exception 'INSTITUICAO_COM_VINCULO'
      using hint = 'Encerre os vínculos antes de excluir, ou desative a instituição.';
  end if;

  if exists (select 1 from documento where instituicao_id = old.id) then
    raise exception 'INSTITUICAO_COM_DOCUMENTO'
      using hint = 'Remova os documentos antes, ou desative a instituição.';
  end if;

  return old;
end $$;

-- =============================================================================
-- PARTE 4 — Controle de acesso
-- =============================================================================

alter table documento_conteudo enable row level security;

-- O conteúdo segue a mesma regra do metadado: quem enxerga o documento pode
-- baixar. A política olha para a linha de `documento`, então uma mudança de
-- permissão lá vale aqui sem precisar ser repetida.
create policy documento_conteudo_ler on documento_conteudo
  for select using (
    exists (select 1 from documento d where d.id = documento_id)
  );

create policy documento_conteudo_inserir on documento_conteudo
  for insert with check (papel_atual() in ('admin', 'gestor'));

create policy documento_conteudo_excluir on documento_conteudo
  for delete using (papel_atual() = 'admin');

grant select, insert, delete on documento_conteudo to app_web;

commit;
