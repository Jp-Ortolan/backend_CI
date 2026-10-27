-- =============================================================================
-- 015 — Governança das atividades  ·  feature/governanca-atividades
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- O que o contrato /api/governanca pede para reuniões e eventos e o banco
-- ainda não tinha:
--
--   1. Convocação por instituição, com entrega de e-mail rastreada
--      (pendente / enviada / entregue / falhou) e resposta da instituição
--      (RSVP). RSVP não é presença.
--   2. Idempotência de operações repetidas pelo front (presença guardada
--      offline e reenviada, convocação reenviada após falha de rede): a mesma
--      chave com o mesmo conteúdo devolve o mesmo resultado sem duplicar.
--   3. Encaminhamento estruturado: título, responsável (pessoa do cadastro) e
--      resultado obrigatório ao concluir ou cancelar.
--   4. Check-in: assinatura digitada (declaração simples, não certificado),
--      convidado não registra duas vezes, e a hora "offline" do dispositivo
--      fica guardada só como informação — a oficial é a do servidor.
--   5. Instituições convocadas da reunião (ficha de governança da reunião).
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — Campos novos
-- =============================================================================

alter table reuniao add column instituicoes_convocadas uuid[] not null default '{}';

alter table encaminhamento
  add column titulo                text,
  add column resultado             text,
  add column responsavel_pessoa_id uuid references pessoa(id) on delete set null;

-- O que existia vira título (a primeira linha da descrição).
update encaminhamento set titulo = left(split_part(descricao, E'\n', 1), 200) where titulo is null;

alter table encaminhamento
  add constraint encaminhamento_resultado_ao_fechar
  check (status not in ('concluido', 'cancelado') or titulo is null or nullif(trim(resultado), '') is not null)
  not valid;  -- os antigos, sem resultado, continuam valendo; os novos não.

alter table presenca
  add column assinatura_nome       text,
  add column registrado_offline_em timestamptz;

comment on column presenca.assinatura_nome is
  'Nome digitado pelo participante como assinatura simples no check-in. '
  'Declaração de presença, não assinatura com certificado digital.';
comment on column presenca.registrado_offline_em is
  'Hora informada pelo dispositivo quando a presença foi guardada sem conexão. '
  'Só informação: a hora oficial é created_at/horario_checkin, do servidor.';

-- =============================================================================
-- PARTE 2 — Convocações
-- =============================================================================

create type status_entrega as enum ('pendente', 'enviada', 'entregue', 'falhou');
create type resposta_convocacao as enum ('confirmada', 'recusada');

create table convocacao (
  id                 uuid primary key default gen_random_uuid(),
  reuniao_id         uuid not null references reuniao(id) on delete cascade,
  instituicao_id     uuid not null references instituicao(id) on delete restrict,
  assunto            text not null check (char_length(assunto) between 1 and 200),
  mensagem           text not null check (char_length(mensagem) between 1 and 5000),
  prazo_resposta     timestamptz,
  enviada_em         timestamptz not null default now(),
  enviada_por        uuid references usuario(id) on delete set null,
  status_entrega     status_entrega not null default 'pendente',
  entrega_detalhe    text,
  destinatarios      integer not null default 0,
  resposta           resposta_convocacao,
  representante_pessoa_id uuid references pessoa(id) on delete set null,
  justificativa      text,
  respondida_em      timestamptz,
  respondida_por     uuid references usuario(id) on delete set null,
  versao_registro    integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint convocacao_uma_por_instituicao unique (reuniao_id, instituicao_id),
  constraint convocacao_confirmada_tem_representante
    check (resposta is distinct from 'confirmada' or representante_pessoa_id is not null),
  constraint convocacao_recusada_tem_justificativa
    check (resposta is distinct from 'recusada' or nullif(trim(justificativa), '') is not null),
  constraint convocacao_respondida_tem_data
    check ((resposta is null) = (respondida_em is null))
);

create index convocacao_instituicao_idx on convocacao (instituicao_id, enviada_em desc);

create trigger convocacao_touch before update on convocacao
  for each row execute function tg_touch_updated_at();
create trigger convocacao_versao before update on convocacao
  for each row execute function tg_versao_registro();
create trigger convocacao_auditoria after insert or update or delete on convocacao
  for each row execute function tg_auditar();

-- O representante responde; não muda assunto, mensagem, prazo nem a entrega.
create or replace function tg_convocacao_guarda_representante() returns trigger
language plpgsql as $$
begin
  if usuario_atual_id() is null or eh_gestao() then return new; end if;
  if new.reuniao_id      is distinct from old.reuniao_id
  or new.instituicao_id  is distinct from old.instituicao_id
  or new.assunto         is distinct from old.assunto
  or new.mensagem        is distinct from old.mensagem
  or new.prazo_resposta  is distinct from old.prazo_resposta
  or new.enviada_em      is distinct from old.enviada_em
  or new.enviada_por     is distinct from old.enviada_por
  or new.status_entrega  is distinct from old.status_entrega
  or new.entrega_detalhe is distinct from old.entrega_detalhe
  or new.destinatarios   is distinct from old.destinatarios then
    raise exception 'SEM_PERMISSAO_CONVOCACAO'
      using hint = 'A instituição só responde à convocação.';
  end if;
  if new.respondida_por is distinct from usuario_atual_id() then
    raise exception 'SEM_PERMISSAO_CONVOCACAO';
  end if;
  return new;
end $$;

create trigger convocacao_guarda before update on convocacao
  for each row execute function tg_convocacao_guarda_representante();

alter table convocacao enable row level security;
create policy convocacao_ler on convocacao for select
  using (eh_gestao() or instituicao_id = instituicao_atual_id());
create policy convocacao_inserir on convocacao for insert with check (eh_gestao());
create policy convocacao_atualizar on convocacao for update
  using (eh_gestao() or instituicao_id = instituicao_atual_id())
  with check (eh_gestao() or instituicao_id = instituicao_atual_id());
grant select, insert, update on convocacao to app_web;

-- =============================================================================
-- PARTE 3 — Idempotência
-- =============================================================================

create table operacao_idempotente (
  chave       uuid not null,
  usuario_id  uuid not null references usuario(id) on delete cascade,
  escopo      text not null,
  hash        text not null,
  resposta    jsonb,
  created_at  timestamptz not null default now(),
  primary key (usuario_id, chave)
);

comment on table operacao_idempotente is
  'chaveOperacao do front. Repetir a mesma chave com o mesmo conteúdo devolve '
  'a resposta gravada; com conteúdo diferente é recusado. Gravada na MESMA '
  'transação da operação: se a operação falhar, a chave não fica reservada.';

alter table operacao_idempotente enable row level security;
create policy operacao_idempotente_propria on operacao_idempotente
  for all using (usuario_id = usuario_atual_id()) with check (usuario_id = usuario_atual_id());
grant select, insert, update on operacao_idempotente to app_web;

-- =============================================================================
-- PARTE 4 — Check-in com assinatura digitada
-- =============================================================================

create or replace function checkin_registrar_assinado(
  p_token       text,
  p_pessoa_id   uuid,
  p_nome        text,
  p_email       text,
  p_instituicao text,
  p_modo        text,
  p_ip          text,
  p_assinatura  text)
returns table (out_presenca_id uuid, out_participante text, out_instituicao text,
               out_cargo text, out_tipo tipo_participante,
               out_registrado_em timestamptz, out_ja_existia boolean)
language plpgsql security definer set search_path = public as $$
declare
  r   reuniao;
  reg record;
begin
  if p_assinatura is null or length(trim(p_assinatura)) < 3 then
    raise exception 'ASSINATURA_OBRIGATORIA';
  end if;

  -- Convidado: o mesmo e-mail (ou, sem e-mail, o mesmo nome) não entra duas
  -- vezes na mesma atividade. A trava serializa dois envios simultâneos.
  if p_pessoa_id is null then
    select * into r from reuniao where qr_token = p_token;
    if found then
      perform pg_advisory_xact_lock(hashtext(r.id::text || '|' ||
        coalesce(lower(trim(p_email)), imutavel_unaccent(lower(trim(coalesce(p_nome, '')))))));
      if exists (
        select 1 from presenca pr
         where pr.reuniao_id = r.id and pr.tipo = 'convidado'
           and (case when nullif(trim(coalesce(p_email, '')), '') is not null
                     then lower(pr.email_informado) = lower(trim(p_email))
                     else imutavel_unaccent(lower(pr.nome_informado)) = imutavel_unaccent(lower(trim(p_nome))) end)) then
        raise exception 'PRESENCA_JA_REGISTRADA';
      end if;
    end if;
  end if;

  for reg in select * from checkin_registrar(p_token, p_pessoa_id, p_nome, p_email,
                                             p_instituicao, p_modo, true, p_ip) loop
    if not reg.out_ja_existia then
      update presenca set assinatura_nome = trim(p_assinatura) where id = reg.out_presenca_id;
    end if;
    out_presenca_id := reg.out_presenca_id; out_participante := reg.out_participante;
    out_instituicao := reg.out_instituicao; out_cargo := reg.out_cargo; out_tipo := reg.out_tipo;
    out_registrado_em := reg.out_registrado_em; out_ja_existia := reg.out_ja_existia;
    return next;
  end loop;
end $$;

grant execute on function checkin_registrar_assinado(text, uuid, text, text, text, text, text, text) to app_web;

-- A QR (imagem) pública só existe para atividade publicada: o token não
-- revela título nem nada, mas rascunho não deve ter QR circulando.
create or replace function checkin_token_valido(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from reuniao where qr_token = p_token and status <> 'rascunho')
$$;
grant execute on function checkin_token_valido(text) to app_web;

-- =============================================================================
-- PARTE 5 — A quem avisar (convocação, encaminhamento)
--
-- A Diretoria não lê a tabela de contas (só o admin lê). Para avisar a conta
-- de uma instituição ou de uma pessoa, esta função devolve só o necessário —
-- id, e-mail e se a pessoa aceita aquele tipo de e-mail — e só para a gestão.
-- =============================================================================

create or replace function contatos_para_aviso(p_instituicao_id uuid, p_pessoa_id uuid, p_preferencia text)
returns table (usuario_id uuid, email text, quer_email boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_gestao() then raise exception 'SEM_PERMISSAO_CONTA'; end if;
  return query
    select u.id, u.email, coalesce((u.preferencias ->> p_preferencia)::boolean, true)
      from usuario u
     where u.ativo
       and ((p_instituicao_id is not null and u.papel = 'representante' and u.instituicao_id = p_instituicao_id)
         or (p_pessoa_id is not null and u.pessoa_id = p_pessoa_id))
    union all
    -- O e-mail institucional (sem conta, sem preferência individual).
    select null::uuid, i.email, true
      from instituicao i
     where p_instituicao_id is not null and i.id = p_instituicao_id and i.email is not null;
end $$;
grant execute on function contatos_para_aviso(uuid, uuid, text) to app_web;

commit;
