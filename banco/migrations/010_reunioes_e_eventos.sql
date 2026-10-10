-- =============================================================================
-- 010 — Reuniões e eventos, credenciamento e presença  ·  Revisão de outubro
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- REUNIÃO E EVENTO: REGISTROS DIFERENTES, MESMA PRESENÇA
-- A revisão pede que reunião e evento sejam registros diferentes "mesmo que
-- compartilhem presença e participantes". A forma de ter as duas coisas é a
-- mesma tabela com uma coluna que diz o que a linha é — `natureza`:
--
--   * presença, convite, QR Code e lista continuam funcionando para os dois,
--     sem duplicar uma linha de código nem uma regra de banco;
--   * a API separa: /api/reunioes só devolve reunião, /api/eventos só evento;
--   * cada natureza tem os seus tipos (tipo_atividade) e os seus campos.
--
-- Duas tabelas separadas obrigariam presenca.reuniao_id a virar "reuniao_id OU
-- evento_id", e todas as views de indicador a fazer UNION — mais lugar para o
-- número de uma tela não bater com o da outra.
--
-- A tabela continua se chamando `reuniao` para não quebrar o que já existe.
--
-- O QUE MAIS ENTRA
--   * conta_participacao — se a atividade entra no percentual OFICIAL. Reunião
--     ordinária e extraordinária contam; workshop, palestra e reunião de GT não.
--     Antes, TODA reunião encerrada contava para TODA instituição.
--   * credenciamento — abrir/fechar na hora, convidado permitido ou não, limite
--     de participantes, presença presencial ou on-line, assinatura simples.
--   * encaminhamentos — o que a reunião decidiu, com responsável e prazo.
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — Natureza e tipo
-- =============================================================================

create type natureza_atividade as enum ('reuniao', 'evento');
create type modalidade_atividade as enum ('presencial', 'online', 'hibrida');

create table tipo_atividade (
  id                        smallserial primary key,
  nome                      text not null unique,
  natureza                  natureza_atividade not null,
  -- Valor inicial do campo conta_participacao quando a atividade é criada com
  -- este tipo. A Diretoria pode mudar caso a caso.
  conta_participacao_padrao boolean not null default false,
  ativo                     boolean not null default true
);

insert into tipo_atividade (nome, natureza, conta_participacao_padrao) values
  ('Reunião ordinária',             'reuniao', true),
  ('Reunião extraordinária',        'reuniao', true),
  ('Reunião de diretoria',          'reuniao', false),
  ('Reunião de GT',                 'reuniao', false),
  ('Workshop',                      'evento',  false),
  ('Missão técnica',                'evento',  false),
  ('Palestra',                      'evento',  false),
  ('Evento parceiro',               'evento',  false),
  ('Evento do calendário unificado','evento',  false);

-- =============================================================================
-- PARTE 2 — Campos da reunião e do evento
-- =============================================================================

alter table reuniao
  add column natureza                 natureza_atividade not null default 'reuniao',
  add column tipo_atividade_id        smallint references tipo_atividade(id) on delete set null,
  add column numero                   integer,
  add column modalidade               modalidade_atividade not null default 'presencial',
  add column responsavel              text,
  add column publico_alvo             text,
  add column limite_participantes     integer,
  -- Toda reunião que já existia contava no percentual: continua contando.
  add column conta_participacao       boolean not null default true,
  add column permite_convidado        boolean not null default true,
  add column exibir_publico           boolean not null default false,
  add column grupo_trabalho_id        smallint references grupo_trabalho(id) on delete set null,
  -- Só de evento:
  add column organizacao_responsavel  text,
  add column evento_proprio           boolean not null default true,
  add column inscricao_url            text,
  add column total_participantes_externo integer;

alter table reuniao
  add constraint reuniao_numero_positivo     check (numero is null or numero > 0),
  add constraint reuniao_limite_positivo     check (limite_participantes is null or limite_participantes > 0),
  add constraint reuniao_total_externo_ok    check (total_participantes_externo is null or total_participantes_externo >= 0),
  add constraint reuniao_inscricao_http      check (inscricao_url is null or inscricao_url ~* '^https?://');

-- "68ª Reunião Ordinária": o número não se repete dentro do mesmo tipo.
create unique index reuniao_numero_por_tipo
  on reuniao (tipo_atividade_id, numero) where numero is not null;

create index reuniao_natureza_idx on reuniao (natureza, data desc);
create index reuniao_publica_idx  on reuniao (data) where exibir_publico;

comment on column reuniao.natureza is
  'reuniao ou evento. Mesma tabela de propósito: presença, convite e QR Code '
  'servem aos dois. Ver o cabeçalho da migration 010.';
comment on column reuniao.conta_participacao is
  'Se a atividade entra no percentual OFICIAL de participação das instituições.';
comment on column reuniao.exibir_publico is
  'Aparece no calendário do painel público (sem login).';

-- =============================================================================
-- PARTE 3 — Encaminhamentos: o que a reunião decidiu
-- =============================================================================

create type status_encaminhamento as enum ('pendente', 'em_andamento', 'concluido', 'cancelado');

create table encaminhamento (
  id                        uuid primary key default gen_random_uuid(),
  reuniao_id                uuid not null references reuniao(id) on delete cascade,
  descricao                 text not null,
  responsavel               text,
  responsavel_instituicao_id uuid references instituicao(id) on delete set null,
  prazo                     date,
  status                    status_encaminhamento not null default 'pendente',
  concluido_em              date,
  observacoes               text,
  created_by                uuid references usuario(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint encaminhamento_concluido_tem_data
    check (status <> 'concluido' or concluido_em is not null)
);

create index encaminhamento_reuniao_idx on encaminhamento (reuniao_id);
create index encaminhamento_aberto_idx  on encaminhamento (prazo)
  where status in ('pendente', 'em_andamento');

create trigger encaminhamento_touch before update on encaminhamento
  for each row execute function tg_touch_updated_at();
create trigger encaminhamento_auditoria after insert or update or delete on encaminhamento
  for each row execute function tg_auditar();

-- =============================================================================
-- PARTE 4 — Presença: equipe, modo e assinatura simples
-- =============================================================================

alter table presenca
  add column modo           text,
  add column assinado_em    timestamptz,
  add column assinatura_ip  text;

alter table presenca
  add constraint presenca_modo_valido check (modo is null or modo in ('presencial', 'online'));

comment on column presenca.assinado_em is
  'Assinatura eletrônica simples: o participante confirmou "declaro que estive '
  'presente" no check-in. Junto vai o IP. Não é assinatura com certificado.';

-- A 001 só conhecia representante e convidado. A equipe do Centro entra na
-- lista mas, como o convidado, não carrega vínculo oficial — e por isso nunca
-- entra na conta de participação das instituições.
alter table presenca drop constraint presenca_convidado_sem_vinculo;
alter table presenca add constraint presenca_convidado_sem_vinculo check (
     (tipo = 'representante' and pessoa_id is not null)
  or (tipo = 'convidado' and vinculo_id is null and nome_informado is not null)
  or (tipo = 'equipe'    and vinculo_id is null
                         and (pessoa_id is not null or nome_informado is not null))
);

-- =============================================================================
-- PARTE 5 — Indicadores passam a respeitar conta_participacao
--
-- Só muda o recorte; as colunas continuam as mesmas, na mesma ordem (CREATE OR
-- REPLACE VIEW exige isso, e é o que garante que nenhuma tela quebra).
-- =============================================================================

create or replace view vw_reuniao_esperada with (security_invoker = true) as
select v.id as vinculo_id, v.pessoa_id, v.instituicao_id,
       r.id as reuniao_id, r.data as reuniao_data
from vinculo v
join reuniao r
  on r.status = 'encerrada'
 and r.conta_participacao
 and r.data >= v.data_inicio
 and (v.data_fim is null or r.data <= v.data_fim);

-- Resumo por atividade. Para a que conta no percentual oficial, o esperado é
-- todo vínculo vigente na data (como antes). Para a que não conta — workshop,
-- reunião de GT —, esperado é quem foi convidado: não faz sentido acusar 120
-- instituições de faltar a uma palestra para a qual ninguém as chamou.
create or replace view vw_resumo_reuniao with (security_invoker = true) as
select r.id as reuniao_id, r.titulo, r.data, r.status,
       count(pr.id) as total_registros,
       count(pr.id) filter (where pr.status = 'presente')  as presentes,
       count(pr.id) filter (where pr.status = 'ausente')   as ausentes,
       count(pr.id) filter (where pr.tipo   = 'convidado') as convidados,
       count(distinct pr.instituicao_id) as instituicoes_presentes,
       round(100.0 * count(pr.id) filter (where pr.status = 'presente')
             / nullif(count(pr.id), 0), 1) as percentual_presenca,

       case when r.conta_participacao then
         (select count(*) from vinculo v
           where v.data_inicio <= r.data
             and (v.data_fim is null or v.data_fim >= r.data))
       else
         (select count(*) from reuniao_convite c where c.reuniao_id = r.id)
       end as esperados,

       round(100.0 * count(pr.id) filter (where pr.status = 'presente'
                                            and pr.tipo   = 'representante')
             / nullif(case when r.conta_participacao then
                        (select count(*) from vinculo v
                          where v.data_inicio <= r.data
                            and (v.data_fim is null or v.data_fim >= r.data))
                      else
                        (select count(*) from reuniao_convite c where c.reuniao_id = r.id)
                      end, 0), 1)
         as percentual_comparecimento,

       (select count(*) from reuniao_convite c
         where c.reuniao_id = r.id) as convites_enviados,

       (select count(*) from reuniao_convite c
         where c.reuniao_id = r.id and c.status = 'confirmado') as confirmados,

       -- ↓ colunas novas da 010
       r.natureza,
       r.conta_participacao,
       count(pr.id) filter (where pr.tipo = 'equipe') as equipe,
       count(pr.id) filter (where pr.status = 'justificado') as justificados
from reuniao r
left join presenca pr on pr.reuniao_id = r.id
group by r.id, r.titulo, r.data, r.status;

-- O cartão "média de presença" é a média OFICIAL: só atividade que conta.
-- reunioes_realizadas passa a contar só reunião; evento ganha cartão próprio.
create or replace view vw_dashboard with (security_invoker = true) as
select
  (select count(*) from instituicao where status = 'ativa')   as instituicoes_ativas,
  (select count(*) from instituicao where status in ('inativa', 'desligada')) as instituicoes_inativas,
  (select count(*) from instituicao
     where status in ('rascunho', 'aguardando_documentos', 'em_analise',
                      'ajustes_solicitados', 'em_processo_saida')) as instituicoes_em_processo,
  (select count(*) from vinculo where status = 'ativo')       as representantes_ativos,
  (select count(*) from reuniao
     where status = 'encerrada' and natureza = 'reuniao')     as reunioes_realizadas,
  (select round(avg(percentual_comparecimento), 1)
     from vw_resumo_reuniao
    where status = 'encerrada' and conta_participacao)        as media_presenca,
  (select count(*) from reuniao
     where status = 'agendada' and data >= current_date)      as reunioes_agendadas,
  -- ↓ colunas novas da 010
  (select count(*) from reuniao
     where status = 'encerrada' and natureza = 'evento')      as eventos_realizados,
  (select count(*) from solicitacao where status = 'pendente') as solicitacoes_pendentes;

-- Lista de participantes: as mesmas colunas da 003, mais modo, assinatura,
-- observação e quem lançou/corrigiu ("registrar quem realizou cada correção").
create or replace view vw_reuniao_participante with (security_invoker = true) as
select
  coalesce(c.reuniao_id, p.reuniao_id)         as reuniao_id,
  c.id                                          as convite_id,
  p.id                                          as presenca_id,
  coalesce(c.pessoa_id, p.pessoa_id)            as pessoa_id,
  coalesce(c.vinculo_id, p.vinculo_id)          as vinculo_id,
  coalesce(c.instituicao_id, p.instituicao_id)  as instituicao_id,
  coalesce(pe.nome, p.nome_informado)           as nome,
  coalesce(i.nome, p.instituicao_informada)     as instituicao,
  coalesce(p.cargo_no_momento, v.cargo)         as cargo,
  coalesce(p.tipo, 'representante')             as tipo,
  coalesce(c.status, 'pendente')                as status_confirmacao,
  c.respondido_em,
  p.status                                      as status_presenca,
  p.horario_checkin,
  p.origem                                      as origem_presenca,
  -- ↓ colunas novas da 010
  p.modo,
  p.assinado_em,
  p.observacoes                                 as observacoes_presenca,
  autor.nome                                    as registrado_por,
  v.tipo_representacao
from reuniao_convite c
full join presenca p
  on p.reuniao_id = c.reuniao_id
 and p.pessoa_id  = c.pessoa_id
left join pessoa      pe on pe.id = coalesce(c.pessoa_id, p.pessoa_id)
left join instituicao i  on i.id  = coalesce(c.instituicao_id, p.instituicao_id)
left join vinculo     v  on v.id  = coalesce(c.vinculo_id, p.vinculo_id)
left join vw_usuario_publico autor on autor.id = p.registrado_por;

-- =============================================================================
-- PARTE 6 — Check-in público, versão 2
--
-- As funções mudam de assinatura (colunas e parâmetros novos), então precisam
-- ser recriadas. Quem chamava com os parâmetros antigos continua funcionando:
-- os novos têm valor padrão.
-- =============================================================================

drop function checkin_reuniao(text);
create function checkin_reuniao(p_token text)
returns table (titulo text, data date, hora_inicio time, local text,
               status status_reuniao, aberto boolean,
               natureza natureza_atividade, tipo text,
               modalidade modalidade_atividade, permite_convidado boolean,
               vagas_restantes integer)
language sql stable security definer set search_path = public as $$
  select r.titulo, r.data, r.hora_inicio, r.local, r.status, checkin_aberto(r.*),
         r.natureza, t.nome, r.modalidade, r.permite_convidado,
         case when r.limite_participantes is null then null
              else greatest(0, r.limite_participantes
                    - (select count(*) from presenca p
                        where p.reuniao_id = r.id and p.status = 'presente'))::int
         end
  from reuniao r
  left join tipo_atividade t on t.id = r.tipo_atividade_id
  where r.qr_token = p_token
    and r.status <> 'rascunho'
$$;

drop function checkin_registrar(text, uuid, text, text, text);
create function checkin_registrar(
  p_token       text,
  p_pessoa_id   uuid    default null,
  p_nome        text    default null,
  p_email       text    default null,
  p_instituicao text    default null,
  p_modo        text    default null,
  p_assinar     boolean default false,
  p_ip          text    default null)
returns table (out_presenca_id uuid, out_participante text, out_instituicao text,
               out_cargo text, out_tipo tipo_participante,
               out_registrado_em timestamptz, out_ja_existia boolean)
language plpgsql security definer set search_path = public as $$
declare
  r          reuniao;
  v          vinculo;
  v_pessoa   pessoa;
  v_inst     text;
  v_cargo    text;
  v_id       uuid;
  v_horario  timestamptz;
  v_modo     text;
  v_presentes integer;
begin
  select * into r from reuniao where qr_token = p_token;
  if not found or r.status = 'rascunho' then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if r.status = 'cancelada' then raise exception 'REUNIAO_CANCELADA'; end if;
  if not checkin_aberto(r) then raise exception 'CHECKIN_FECHADO'; end if;

  -- Modo: on-line só existe em atividade on-line ou híbrida.
  v_modo := coalesce(p_modo, case r.modalidade when 'online' then 'online' else 'presencial' end);
  if v_modo not in ('presencial', 'online') then raise exception 'MODO_INVALIDO'; end if;
  if v_modo = 'online' and r.modalidade = 'presencial' then raise exception 'MODO_INVALIDO'; end if;

  -- ------------------------------------------------------------- convidado
  if p_pessoa_id is null then
    if not r.permite_convidado then raise exception 'CONVIDADO_NAO_PERMITIDO'; end if;
    if p_nome is null or length(trim(p_nome)) < 3 then
      raise exception 'NOME_INVALIDO';
    end if;
  else
    -- Já registrou? Devolve o registro anterior em vez de falhar (RF34).
    select pr.id, pr.horario_checkin into v_id, v_horario
    from presenca pr where pr.reuniao_id = r.id and pr.pessoa_id = p_pessoa_id
      and pr.status = 'presente';

    if found then
      select i.nome, pr.cargo_no_momento into v_inst, v_cargo
      from presenca pr left join instituicao i on i.id = pr.instituicao_id
      where pr.id = v_id;
      select * into v_pessoa from pessoa pe where pe.id = p_pessoa_id;

      return query select v_id, v_pessoa.nome, v_inst, v_cargo,
                          'representante'::tipo_participante, v_horario, true;
      return;
    end if;
  end if;

  -- Limite de participantes: quem já está dentro não é barrado (acima), quem
  -- chega depois de lotar, é.
  if r.limite_participantes is not null then
    select count(*) into v_presentes from presenca p
     where p.reuniao_id = r.id and p.status = 'presente';
    if v_presentes >= r.limite_participantes then raise exception 'LIMITE_ATINGIDO'; end if;
  end if;

  if p_pessoa_id is null then
    insert into presenca (reuniao_id, tipo, status, origem, horario_checkin,
                          nome_informado, email_informado, instituicao_informada,
                          modo, assinado_em, assinatura_ip)
    values (r.id, 'convidado', 'presente', 'qrcode', now(),
            trim(p_nome), nullif(trim(coalesce(p_email,'')), ''),
            nullif(trim(coalesce(p_instituicao,'')), ''),
            v_modo,
            case when p_assinar then now() end,
            case when p_assinar then p_ip end)
    returning id, horario_checkin into v_id, v_horario;

    return query select v_id, trim(p_nome), nullif(trim(coalesce(p_instituicao,'')),''),
                        null::text, 'convidado'::tipo_participante, v_horario, false;
    return;
  end if;

  -- --------------------------------------------------------- representante
  select * into v_pessoa from pessoa pe where pe.id = p_pessoa_id;
  if not found then raise exception 'PESSOA_NAO_ENCONTRADA'; end if;

  -- Vínculo válido NA DATA DA REUNIÃO, não o atual — é o snapshot (RF31).
  select * into v from vinculo vi
   where vi.pessoa_id = p_pessoa_id
     and vi.data_inicio <= r.data
     and (vi.data_fim is null or vi.data_fim >= r.data)
   order by (vi.status = 'ativo') desc,
            (vi.tipo_representacao = 'titular') desc,
            vi.data_inicio desc
   limit 1;

  if not found then raise exception 'VINCULO_INVALIDO'; end if;

  select i.nome into v_inst from instituicao i where i.id = v.instituicao_id;

  -- Pode já existir linha 'ausente' ou 'justificado' (lançada antes, à mão): o
  -- check-in de verdade a corrige em vez de bater na constraint de unicidade.
  insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id,
                        cargo_no_momento, tipo, status, origem, horario_checkin,
                        modo, assinado_em, assinatura_ip)
  values (r.id, p_pessoa_id, v.id, v.instituicao_id, v.cargo,
          'representante', 'presente', 'qrcode', now(),
          v_modo,
          case when p_assinar then now() end,
          case when p_assinar then p_ip end)
  on conflict (reuniao_id, pessoa_id) do update
     set status = 'presente', origem = 'qrcode', horario_checkin = now(),
         modo = excluded.modo, assinado_em = excluded.assinado_em,
         assinatura_ip = excluded.assinatura_ip
  returning id, horario_checkin into v_id, v_horario;

  return query select v_id, v_pessoa.nome, v_inst, v.cargo,
                      'representante'::tipo_participante, v_horario, false;
end $$;

-- "Se estiver logado, os dados aparecem automaticamente." A aplicação passa a
-- pessoa da SESSÃO (nunca do corpo da requisição); a função diz quem ela é
-- naquela data e se já registrou.
create or replace function checkin_quem_sou(p_token text, p_pessoa_id uuid)
returns table (nome text, instituicao text, cargo text,
               pode_registrar boolean, ja_registrado boolean)
language sql stable security definer set search_path = public as $$
  select p.nome, i.nome, v.cargo,
         v.id is not null,
         exists (select 1 from presenca pr
                  where pr.reuniao_id = r.id and pr.pessoa_id = p.id
                    and pr.status = 'presente')
    from reuniao r
    join pessoa p on p.id = p_pessoa_id
    left join lateral (
      select vi.* from vinculo vi
       where vi.pessoa_id = p.id
         and vi.data_inicio <= r.data
         and (vi.data_fim is null or vi.data_fim >= r.data)
       order by (vi.status = 'ativo') desc, (vi.tipo_representacao = 'titular') desc,
                vi.data_inicio desc
       limit 1) v on true
    left join instituicao i on i.id = v.instituicao_id
   where r.qr_token = p_token
     and r.status <> 'rascunho'
$$;

grant execute on function
  checkin_reuniao(text),
  checkin_registrar(text, uuid, text, text, text, text, boolean, text),
  checkin_quem_sou(text, uuid)
to app_web;

-- A busca por nome não muda de assinatura, mas não pode achar reunião em rascunho.
create or replace function checkin_buscar(p_token text, p_termo text)
returns table (pessoa_id uuid, nome text, instituicao text,
               cargo text, vinculo_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare r reuniao;
begin
  select * into r from reuniao where qr_token = p_token;
  if not found or r.status = 'rascunho' then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if not checkin_aberto(r) then raise exception 'CHECKIN_FECHADO'; end if;
  if length(trim(p_termo)) < 3 then raise exception 'TERMO_CURTO'; end if;

  return query
  select p.id, p.nome, i.nome, v.cargo, v.id
  from vinculo v
  join pessoa p      on p.id = v.pessoa_id
  join instituicao i on i.id = v.instituicao_id
  where v.status = 'ativo'
    and (select bool_and(p.nome_busca like '%' || palavra || '%')
         from unnest(string_to_array(imutavel_unaccent(lower(trim(p_termo))), ' ')) palavra
         where palavra <> '')
  order by similarity(p.nome_busca, imutavel_unaccent(lower(trim(p_termo)))) desc, p.nome
  limit 5;
end $$;

-- Rascunho não abre check-in, nem com janela definida.
create or replace function checkin_aberto(r reuniao) returns boolean
language sql stable as $$
  select case
    when r.status in ('cancelada', 'encerrada', 'rascunho') then false
    when r.checkin_abre_em  is not null and now() < r.checkin_abre_em  then false
    when r.checkin_fecha_em is not null and now() > r.checkin_fecha_em then false
    when r.checkin_abre_em is null and r.checkin_fecha_em is null
      then r.data = current_date
    else true
  end
$$;

-- =============================================================================
-- PARTE 7 — Controle de acesso das tabelas novas
-- =============================================================================

alter table tipo_atividade enable row level security;
alter table encaminhamento enable row level security;

create policy tipo_atividade_ler on tipo_atividade for select
  using (usuario_atual_id() is not null);
create policy tipo_atividade_inserir on tipo_atividade for insert with check (eh_gestao());
create policy tipo_atividade_atualizar on tipo_atividade for update
  using (eh_gestao()) with check (eh_gestao());

-- Encaminhamento segue a reunião: quem enxerga a reunião enxerga o que ela
-- decidiu. Só a gestão escreve.
create policy encaminhamento_ler on encaminhamento for select
  using (exists (select 1 from reuniao r where r.id = reuniao_id));
create policy encaminhamento_inserir on encaminhamento for insert with check (eh_gestao());
create policy encaminhamento_atualizar on encaminhamento for update
  using (eh_gestao()) with check (eh_gestao());
create policy encaminhamento_excluir on encaminhamento for delete using (eh_gestao());

grant select, insert, update, delete on tipo_atividade, encaminhamento to app_web;
grant usage, select on sequence tipo_atividade_id_seq to app_web;

commit;
