-- =============================================================================
-- 009 — Cadastro do Fórum: instituição, representação e solicitações
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- O QUE A REVISÃO PEDIU E VEM AQUI
--   Instituição   razão social e nome fantasia, vertente do ecossistema, GTs,
--                 redes sociais, contatos de comunicação, logo, autorização de
--                 divulgação (da instituição e da logo), motivo da saída e
--                 instituição que a substituiu.
--   Representação titular / suplente / integrante / convidado, cargo no Fórum,
--                 motivo do encerramento, ofício que formalizou, GTs.
--   Pessoa        autorização para receber comunicações.
--   Solicitações  alterações sensíveis não substituem o dado na hora: viram
--                 pedido que a Diretoria aprova ou recusa (troca de titular e de
--                 suplente, nome/CNPJ, novo ofício, entrada e saída do Fórum,
--                 correção de presença).
--
-- O que já existia e só muda de nome na tela:
--   data de ingresso no Fórum  = instituicao.data_entrada
--   situação da adesão         = instituicao.status (fluxo novo na 007)
--   observações internas       = instituicao.observacoes
--   histórico de alterações    = log_auditoria + instituicao_status_historico
--   ofício / termo de adesão   = documento com tipo 'oficio' / 'termo_adesao'
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — Vertente e Grupos de Trabalho
-- Listas que o próprio Fórum mantém. Nascem vazias de propósito: os nomes das
-- vertentes e dos GTs são decisão do Fórum, não do sistema. A Diretoria
-- cadastra pela rota /api/dominios.
-- =============================================================================

create table vertente (
  id        smallserial primary key,
  nome      text not null unique,
  descricao text,
  ativo     boolean not null default true
);

create table grupo_trabalho (
  id          smallserial primary key,
  nome        text not null unique,
  descricao   text,
  vertente_id smallint references vertente(id) on delete set null,
  ativo       boolean not null default true
);

create table instituicao_grupo_trabalho (
  instituicao_id    uuid     not null references instituicao(id)    on delete cascade,
  grupo_trabalho_id smallint not null references grupo_trabalho(id) on delete cascade,
  primary key (instituicao_id, grupo_trabalho_id)
);

create table vinculo_grupo_trabalho (
  vinculo_id        uuid     not null references vinculo(id)        on delete cascade,
  grupo_trabalho_id smallint not null references grupo_trabalho(id) on delete cascade,
  primary key (vinculo_id, grupo_trabalho_id)
);

create index vinculo_gt_gt_idx     on vinculo_grupo_trabalho (grupo_trabalho_id);
create index instituicao_gt_gt_idx on instituicao_grupo_trabalho (grupo_trabalho_id);

-- =============================================================================
-- PARTE 2 — Instituição
-- =============================================================================

alter table instituicao
  add column razao_social         text,
  add column nome_fantasia        text,
  add column vertente_id          smallint references vertente(id) on delete set null,
  add column redes_sociais        jsonb not null default '{}'::jsonb,
  add column contatos_comunicacao jsonb not null default '[]'::jsonb,
  add column logo_documento_id    uuid references documento(id) on delete set null,
  add column autoriza_divulgacao  boolean not null default false,
  add column autoriza_logo        boolean not null default false,
  add column motivo_saida         text,
  add column substituida_por_id   uuid references instituicao(id) on delete set null;

alter table instituicao
  add constraint instituicao_redes_objeto
    check (jsonb_typeof(redes_sociais) = 'object'),
  add constraint instituicao_contatos_lista
    check (jsonb_typeof(contatos_comunicacao) = 'array'),
  -- Desligada é saída de vez: precisa de data, como a inativa.
  add constraint instituicao_desligada_tem_saida
    check (status <> 'desligada' or data_saida is not null),
  add constraint instituicao_nao_substitui_a_si
    check (substituida_por_id is null or substituida_por_id <> id);

create index instituicao_vertente_idx on instituicao (vertente_id);

comment on column instituicao.nome is
  'Nome de exibição (o que aparece nas listas e no painel). razao_social e '
  'nome_fantasia são os do CNPJ.';
comment on column instituicao.autoriza_divulgacao is
  'A instituição autorizou aparecer no painel público. Sem isto ela não sai '
  'em nenhuma rota pública, nem pelo nome.';
comment on column instituicao.autoriza_logo is
  'Autorização separada para a logo. Pode autorizar o nome e não a marca.';
comment on column instituicao.redes_sociais is
  'Objeto {instagram, linkedin, facebook, youtube, outro}: só endereços http(s), '
  'conferidos na aplicação.';
comment on column instituicao.contatos_comunicacao is
  'Lista de {nome, email, telefone, funcao}: quem recebe a comunicação do Fórum '
  '(assessoria, secretaria). Não é representante e não conta em presença.';

-- O texto padrão da 001 ("em_processo_entrada") virou 'em_analise' na 007.
-- Instituição nova, criada pela Diretoria, começa como rascunho.
alter table instituicao alter column status set default 'rascunho';

-- =============================================================================
-- PARTE 3 — Representação: titular, suplente, integrante, convidado
-- =============================================================================

create type tipo_representacao as enum ('titular', 'suplente', 'integrante', 'convidado');

alter table vinculo
  add column tipo_representacao  tipo_representacao not null default 'integrante',
  add column cargo_forum         text,
  add column motivo_encerramento text,
  add column oficio_documento_id uuid references documento(id) on delete set null;

-- Uma instituição tem UM titular e UM suplente vigentes. A troca encerra o
-- anterior antes de criar o novo (é o que a aprovação da solicitação faz).
create unique index vinculo_titular_unico
  on vinculo (instituicao_id) where status = 'ativo' and tipo_representacao = 'titular';
create unique index vinculo_suplente_unico
  on vinculo (instituicao_id) where status = 'ativo' and tipo_representacao = 'suplente';

comment on column vinculo.cargo       is 'Cargo NA INSTITUIÇÃO (Pró-reitor, CTO...).';
comment on column vinculo.cargo_forum is
  'Cargo NO FÓRUM, quando houver (Presidente, Vice, Secretário). É o que monta a '
  'composição da Diretoria no painel público.';

alter table pessoa
  add column autoriza_comunicacao boolean not null default false;

comment on column pessoa.autoriza_comunicacao is
  'Consentimento para receber e-mail e mensagem do Fórum (LGPD). Sem ele, a '
  'pessoa não entra em lista de envio.';

-- =============================================================================
-- PARTE 4 — Solicitações de alteração
--
-- O representante pede; a Diretoria (ou o admin) decide. A solicitação guarda
-- o pedido inteiro em `dados` e só quando é aprovada a mudança acontece — pela
-- aplicação, na mesma transação da aprovação (aplicar-solicitacao.js).
-- =============================================================================

create type tipo_solicitacao as enum (
  'alterar_dados',          -- nome, razão social, CNPJ, classificação
  'troca_titular',
  'troca_suplente',
  'incluir_representante',
  'remover_representante',
  'novo_oficio',
  'entrada_forum',
  'saida_forum',
  'correcao_presenca'
);

create type status_solicitacao as enum ('pendente', 'aprovada', 'recusada', 'cancelada');

create table solicitacao (
  id              uuid primary key default gen_random_uuid(),
  instituicao_id  uuid not null references instituicao(id) on delete cascade,
  tipo            tipo_solicitacao not null,
  status          status_solicitacao not null default 'pendente',
  dados           jsonb not null default '{}'::jsonb,
  justificativa   text,
  documento_id    uuid references documento(id) on delete set null,
  reuniao_id      uuid references reuniao(id)   on delete set null,
  solicitado_por  uuid references usuario(id) on delete set null,
  analisado_por   uuid references usuario(id) on delete set null,
  analisado_em    timestamptz,
  resposta        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint solicitacao_dados_objeto check (jsonb_typeof(dados) = 'object'),
  constraint solicitacao_decidida_tem_data check (
       (status in ('pendente', 'cancelada') and analisado_em is null)
    or (status in ('aprovada', 'recusada') and analisado_em is not null)
  )
);

create index solicitacao_instituicao_idx on solicitacao (instituicao_id, created_at desc);
create index solicitacao_pendente_idx    on solicitacao (created_at) where status = 'pendente';

create trigger solicitacao_touch before update on solicitacao
  for each row execute function tg_touch_updated_at();

create trigger solicitacao_auditoria after insert or update or delete on solicitacao
  for each row execute function tg_auditar();

comment on table solicitacao is
  'Pedido de alteração sensível feito pela instituição. Aprovar aplica o que '
  'está em dados; recusar guarda a resposta. Nada é apagado.';

-- =============================================================================
-- PARTE 5 — Controle de acesso das tabelas novas
-- =============================================================================

alter table vertente                   enable row level security;
alter table grupo_trabalho             enable row level security;
alter table instituicao_grupo_trabalho enable row level security;
alter table vinculo_grupo_trabalho     enable row level security;
alter table solicitacao                enable row level security;

-- Listas de domínio e GTs da instituição: todo logado lê; a gestão escreve.
do $$
declare t text;
begin
  foreach t in array array['vertente', 'grupo_trabalho', 'instituicao_grupo_trabalho']
  loop
    execute format(
      'create policy %I_ler on %I for select using (usuario_atual_id() is not null)', t, t);
    execute format(
      'create policy %I_inserir on %I for insert with check (eh_gestao())', t, t);
    execute format(
      'create policy %I_atualizar on %I for update using (eh_gestao()) with check (eh_gestao())', t, t);
    execute format(
      'create policy %I_excluir on %I for delete using (eh_gestao())', t, t);
  end loop;
end $$;

-- GT do vínculo segue a leitura do vínculo (a política de vinculo já recorta).
create policy vinculo_grupo_trabalho_ler on vinculo_grupo_trabalho for select
  using (exists (select 1 from vinculo v where v.id = vinculo_id));
create policy vinculo_grupo_trabalho_inserir on vinculo_grupo_trabalho for insert
  with check (eh_gestao());
create policy vinculo_grupo_trabalho_excluir on vinculo_grupo_trabalho for delete
  using (eh_gestao());

-- Solicitação: cada instituição vê e abre as suas; a gestão vê e decide todas.
create policy solicitacao_ler on solicitacao for select
  using (eh_gestao() or instituicao_id = instituicao_atual_id());

create policy solicitacao_inserir on solicitacao for insert
  with check (
    eh_gestao()
    or (papel_atual() = 'representante'
        and instituicao_id = instituicao_atual_id()
        and solicitado_por = usuario_atual_id()
        and status = 'pendente')
  );

-- Decidir é da gestão. O representante só CANCELA o pedido dele, e enquanto
-- ainda está pendente.
create policy solicitacao_atualizar on solicitacao for update
  using (eh_gestao()
         or (instituicao_id = instituicao_atual_id() and status = 'pendente'))
  with check (eh_gestao()
              or (instituicao_id = instituicao_atual_id() and status = 'cancelada'));

create policy solicitacao_excluir on solicitacao for delete
  using (papel_atual() = 'admin');

-- -----------------------------------------------------------------------------
-- Avisar a gestão de um pedido novo. A política notificacao_criar só deixa a
-- gestão criar notificação — e quem abre a solicitação é o representante. Em
-- vez de abrir a política, esta função faz SÓ isto: uma notificação para cada
-- admin e Diretoria ativos, com link interno.
-- -----------------------------------------------------------------------------
create or replace function notificar_gestao(p_titulo text, p_mensagem text, p_link text)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_total integer;
begin
  if usuario_atual_id() is null then return 0; end if;
  -- Link sempre interno: notificação com URL externa é vetor de phishing
  -- (mesma regra do comentário de notificacao.link na 002).
  if p_link is not null and p_link !~ '^/[A-Za-z0-9/_-]*$' then
    raise exception 'LINK_INVALIDO';
  end if;
  insert into notificacao (usuario_id, titulo, mensagem, link)
  select id, left(p_titulo, 200), left(p_mensagem, 500), p_link
    from usuario where ativo and papel in ('admin', 'diretoria');
  get diagnostics v_total = row_count;
  return v_total;
end $$;

grant execute on function notificar_gestao(text, text, text) to app_web;

grant select, insert, update, delete
  on vertente, grupo_trabalho, instituicao_grupo_trabalho,
     vinculo_grupo_trabalho, solicitacao
  to app_web;
grant usage, select on sequence vertente_id_seq, grupo_trabalho_id_seq to app_web;

commit;
