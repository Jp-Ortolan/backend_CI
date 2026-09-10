-- =============================================================================
-- 002 — Alinhamento com as telas do Figma  ·  Semana 3
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- POR QUE ESTA MIGRATION EXISTE
-- A responsável pelo front-end mandou uma proposta de 13 tabelas montada a
-- partir das telas. A maior parte já existia na 001 com outro nome — mapa
-- completo em docs/07-alinhamento-modelo-front.md. Esta migration cobre só o
-- que realmente faltava, que veio quase todo do formulário "Nova instituição" e
-- do dashboard:
--
--   1. Área de atuação          — campo obrigatório na tela, não existia
--   2. Endereço completo        — a 001 só guardava cidade e UF
--   3. Data de fundação         — campo obrigatório na tela
--   4. Descrição (500 caracteres) — a tela tem contador, o banco não tinha o campo
--   5. Convite e confirmação    — o dashboard mostra "115 confirmados"; não havia
--                                 linha nenhuma antes da reunião acontecer
--   6. Notificações             — o sino com o contador
--   7. Log de auditoria         — "quem alterou o quê", genérico
--   8. Exclusão de instituição  — a tela oferece "Excluir"; aqui fica a regra
--   9. Fórmula da presença      — corrige o denominador dos indicadores
--
-- A migration 001 NÃO foi editada: ela já rodou. Toda mudança daqui para a
-- frente é arquivo novo.
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — Classificação: área de atuação e tipo de instituição
-- A tela "Nova instituição" tem dois selects obrigatórios lado a lado. Tipo já
-- existia; área de atuação não.
-- =============================================================================

create table area_atuacao (
  id    smallserial primary key,
  nome  text not null unique,
  ativo boolean not null default true
);

comment on table area_atuacao is
  'Áreas do select "Área de atuação". Domínio fechado, editável por admin.';

-- O front pediu "ativo" nas duas tabelas de domínio: some do select sem apagar
-- a linha, senão as instituições antigas ficariam apontando para o nada.
alter table tipo_instituicao add column ativo boolean not null default true;

alter table instituicao
  add column area_atuacao_id smallint references area_atuacao(id) on delete set null;

create index instituicao_area_idx on instituicao (area_atuacao_id);

-- =============================================================================
-- PARTE 2 — Endereço da instituição
--
-- DECISÃO: colunas na própria instituicao, não a tabela separada
-- "enderecos_instituicoes" que o front propôs.
-- Nas telas cada instituição tem exatamente um endereço — o formulário de
-- cadastro tem um bloco só e a tela de detalhe mostra um card só. Uma tabela
-- 1:1 custaria um join em toda listagem e todo detalhe para permitir uma
-- cardinalidade que nenhuma tela usa. Se um dia aparecer "filiais", aí sim vale
-- uma tabela própria — e ela nasce nova, sem mexer nesta.
-- cidade e uf já existiam na 001 e ficam onde estão.
-- =============================================================================

alter table instituicao
  add column logradouro    text,
  add column numero        text,
  add column bairro        text,
  add column cep           char(8),
  add column complemento   text,
  add column data_fundacao date,
  add column descricao     text;

alter table instituicao
  add constraint instituicao_cep_digitos
    check (cep is null or cep ~ '^[0-9]{8}$'),
  -- A tela mostra o contador 0/500. Se a regra só existisse no front, um POST
  -- direto na API passaria por cima dela.
  add constraint instituicao_descricao_tamanho
    check (descricao is null or char_length(descricao) <= 500),
  add constraint instituicao_fundacao_no_passado
    check (data_fundacao is null or data_fundacao <= current_date);

comment on column instituicao.descricao is
  'Texto livre da tela de cadastro, limitado a 500 caracteres. '
  'Diferente de observacoes, que é nota interna da equipe.';

-- O bloco "Próximas reuniões" do dashboard mostra duas linhas de lugar:
-- "Auditório" em cima e "Prefeitura de Guarapuava" embaixo. A 001 tinha só uma
-- coluna, então a segunda linha não teria de onde sair.
alter table reuniao add column endereco text;

comment on column reuniao.local is
  'A sala: "Auditório", "Sala de Reuniões 1". O prédio vai em endereco.';

-- =============================================================================
-- PARTE 3 — Convite e confirmação de presença
--
-- DECISÃO: tabela separada de presenca, e não a "reuniao_participantes" única
-- que o front propôs.
--
-- São dois fatos com naturezas diferentes:
--   convite  — intenção, muda de estado, existe ANTES da reunião
--   presenca — fato consumado, com snapshot do vínculo, existe DEPOIS
--
-- Juntar os dois obrigaria a afrouxar as regras da presenca que já estão
-- testadas: hoje o banco garante que "presente" tem horário e que convidado não
-- carrega vínculo. Numa tabela única, toda linha nasceria como convite vazio e
-- essas garantias teriam de virar opcionais — o banco pararia de proteger
-- justamente o dado que o relatório final usa.
--
-- Separado, cada tabela responde uma pergunta: quantos confirmaram (convite) e
-- quantos apareceram (presenca). O convidado de última hora entra só na
-- presenca, sem convite, e isso continua correto.
-- =============================================================================

create type status_confirmacao as enum ('pendente', 'confirmado', 'recusado');

create table reuniao_convite (
  id              uuid primary key default gen_random_uuid(),
  reuniao_id      uuid not null references reuniao(id)     on delete cascade,
  vinculo_id      uuid not null references vinculo(id)     on delete cascade,
  pessoa_id       uuid not null references pessoa(id)      on delete cascade,
  instituicao_id  uuid not null references instituicao(id) on delete restrict,
  status          status_confirmacao not null default 'pendente',
  respondido_em   timestamptz,
  observacoes     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references usuario(id),
  -- Sem participação duplicada do mesmo vínculo na mesma reunião (regra que a
  -- própria proposta do front pediu).
  constraint convite_vinculo_unico unique (reuniao_id, vinculo_id),
  constraint convite_respondido_tem_data check (
       (status =  'pendente' and respondido_em is null)
    or (status <> 'pendente' and respondido_em is not null)
  )
);

create index convite_reuniao_idx     on reuniao_convite (reuniao_id, status);
create index convite_pessoa_idx      on reuniao_convite (pessoa_id);
create index convite_instituicao_idx on reuniao_convite (instituicao_id);

create trigger reuniao_convite_touch before update on reuniao_convite
  for each row execute function tg_touch_updated_at();

comment on table reuniao_convite is
  'Quem foi convidado e o que respondeu. Alimenta o "N confirmados" do '
  'dashboard. Presença de verdade fica em presenca.';

-- Convidar de uma vez todos os vínculos ativos de instituições ativas. Sem
-- isso, montar uma reunião com 120 instituições vira trabalho manual.
-- Reexecutar é seguro: quem já foi convidado não é duplicado nem tem a
-- resposta apagada.
create or replace function convidar_representantes_ativos(p_reuniao_id uuid)
returns integer
language plpgsql as $$
declare v_inseridos integer;
begin
  insert into reuniao_convite
    (reuniao_id, vinculo_id, pessoa_id, instituicao_id, created_by)
  select p_reuniao_id, v.id, v.pessoa_id, v.instituicao_id, usuario_atual_id()
  from vinculo v
  join instituicao i on i.id = v.instituicao_id
  where v.status = 'ativo'
    and i.status = 'ativa'
  on conflict (reuniao_id, vinculo_id) do nothing;

  get diagnostics v_inseridos = row_count;
  return v_inseridos;
end $$;

-- =============================================================================
-- PARTE 4 — Notificações (o sino do cabeçalho)
-- =============================================================================

create table notificacao (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuario(id) on delete cascade,
  titulo      text not null,
  mensagem    text,
  link        text,
  lida_em     timestamptz,
  created_at  timestamptz not null default now()
);

create index notificacao_usuario_idx  on notificacao (usuario_id, created_at desc);
create index notificacao_nao_lida_idx on notificacao (usuario_id) where lida_em is null;

comment on column notificacao.link is
  'Caminho interno para onde o clique leva, ex: /instituicoes/<uuid>. '
  'Nunca URL absoluta — link externo em notificação é vetor de phishing.';

-- =============================================================================
-- PARTE 5 — Log de auditoria
--
-- A 001 já registrava troca de status de instituição. Isto aqui é o genérico:
-- toda inserção, alteração e exclusão nas tabelas principais, com o antes e o
-- depois só dos campos que mudaram de fato.
-- =============================================================================

create type acao_auditoria as enum ('insercao', 'atualizacao', 'exclusao');

create table log_auditoria (
  id          bigserial primary key,
  usuario_id  uuid references usuario(id) on delete set null,
  entidade    text not null,
  registro_id text not null,
  acao        acao_auditoria not null,
  alteracoes  jsonb,
  created_at  timestamptz not null default now()
);

create index log_auditoria_entidade_idx on log_auditoria (entidade, registro_id, created_at desc);
create index log_auditoria_usuario_idx   on log_auditoria (usuario_id, created_at desc);

comment on table log_auditoria is
  'Histórico de alterações. usuario_id vem de current_setting(app.usuario_id), '
  'então operação feita fora de comUsuario() fica registrada sem autor — e isso '
  'é informação, não defeito.';

-- SECURITY DEFINER porque a trigger precisa gravar mesmo quando a política de
-- INSERT da tabela não liberaria para o papel do usuário. Ela roda como dono e
-- faz só o que está escrito aqui.
create or replace function tg_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_novo       jsonb;
  v_antigo     jsonb;
  v_alteracoes jsonb;
  v_registro   text;
  v_acao       acao_auditoria;
begin
  -- senha_hash nunca entra no log: auditoria não é lugar de guardar segredo,
  -- nem mesmo em hash.
  v_novo   := to_jsonb(new) - 'senha_hash';
  v_antigo := to_jsonb(old) - 'senha_hash';

  if tg_op = 'INSERT' then
    v_acao       := 'insercao';
    v_registro   := v_novo ->> 'id';
    v_alteracoes := jsonb_build_object('depois', v_novo);

  elsif tg_op = 'UPDATE' then
    v_acao     := 'atualizacao';
    v_registro := v_novo ->> 'id';

    select jsonb_object_agg(
             campo.chave,
             jsonb_build_object('antes', v_antigo -> campo.chave,
                                'depois', v_novo   -> campo.chave))
      into v_alteracoes
    from jsonb_each(v_novo) as campo(chave, valor)
    where v_antigo -> campo.chave is distinct from v_novo -> campo.chave
      -- updated_at muda em toda linha e nome_busca é derivado: registrar os
      -- dois encheria o log de ruído.
      and campo.chave not in ('updated_at', 'nome_busca');

    -- UPDATE que não mudou nada de fato não vira linha de log.
    if v_alteracoes is null then return null; end if;

  else
    v_acao       := 'exclusao';
    v_registro   := v_antigo ->> 'id';
    v_alteracoes := jsonb_build_object('antes', v_antigo);
  end if;

  insert into log_auditoria (usuario_id, entidade, registro_id, acao, alteracoes)
  values (usuario_atual_id(), tg_table_name, v_registro, v_acao, v_alteracoes);

  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['usuario','instituicao','pessoa','vinculo',
                           'reuniao','presenca','documento','reuniao_convite']
  loop
    execute format(
      'create trigger %I_auditoria after insert or update or delete on %I
         for each row execute function tg_auditar()', t, t);
  end loop;
end $$;

-- =============================================================================
-- PARTE 6 — Exclusão de instituição preservando o histórico
--
-- A pergunta que ficou em aberto na proposta do front. A resposta do banco:
-- instituição com histórico não se exclui, se desativa.
--
-- A 001 já barrava a exclusão quando existiam vínculos (on delete restrict).
-- O buraco era a presença: presenca.instituicao_id é "on delete set null", ou
-- seja, apagar a instituição não daria erro — apagaria silenciosamente o nome
-- de quem participou das reuniões passadas. A trigger fecha isso.
--
-- O botão "Excluir instituição" da tela continua existindo: ele serve para o
-- cadastro criado por engano, que ainda não tem histórico nenhum.
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

  return old;
end $$;

create trigger instituicao_protege_historico before delete on instituicao
  for each row execute function tg_instituicao_protege_historico();

-- =============================================================================
-- PARTE 7 — Fórmula da presença
--
-- A outra pergunta em aberto: qual é a média de presença e quem entra na conta.
--
-- O QUE ESTAVA ERRADO
-- percentual_presenca dividia os presentes pelo total de LINHAS da presenca.
-- Quem nunca foi registrado não aparecia no denominador, então uma reunião com
-- 3 registros e 3 presentes dava 100% — mesmo com 120 instituições convidadas.
-- Pior: convidado avulso entrava no denominador e derrubava o índice de quem
-- não tinha nada a ver com aquilo.
--
-- O QUE PASSA A VALER
-- comparecimento = representantes presentes ÷ vínculos vigentes na data
-- Convidado não entra nem em cima nem embaixo: ele não era esperado, e o
-- indicador mede exatamente quem era esperado e apareceu.
--
-- percentual_presenca fica onde está, sem mudar de significado, porque os
-- testes da 001 já se apoiam nele. O indicador novo é percentual_comparecimento
-- e é ele que o dashboard usa.
-- =============================================================================

create or replace view vw_resumo_reuniao as
select r.id as reuniao_id, r.titulo, r.data, r.status,
       count(pr.id) as total_registros,
       count(pr.id) filter (where pr.status = 'presente')  as presentes,
       count(pr.id) filter (where pr.status = 'ausente')   as ausentes,
       count(pr.id) filter (where pr.tipo   = 'convidado') as convidados,
       count(distinct pr.instituicao_id) as instituicoes_presentes,
       round(100.0 * count(pr.id) filter (where pr.status = 'presente')
             / nullif(count(pr.id), 0), 1) as percentual_presenca,

       -- ↓ colunas novas da 002
       (select count(*) from vinculo v
         where v.data_inicio <= r.data
           and (v.data_fim is null or v.data_fim >= r.data)) as esperados,

       round(100.0 * count(pr.id) filter (where pr.status = 'presente'
                                            and pr.tipo   = 'representante')
             / nullif((select count(*) from vinculo v
                        where v.data_inicio <= r.data
                          and (v.data_fim is null or v.data_fim >= r.data)), 0), 1)
         as percentual_comparecimento,

       (select count(*) from reuniao_convite c
         where c.reuniao_id = r.id) as convites_enviados,

       (select count(*) from reuniao_convite c
         where c.reuniao_id = r.id and c.status = 'confirmado') as confirmados
from reuniao r
left join presenca pr on pr.reuniao_id = r.id
group by r.id, r.titulo, r.data, r.status;

-- media_presenca do dashboard passa a usar o comparecimento. Só reuniões
-- encerradas entram: reunião em andamento sempre teria índice baixo e puxaria
-- a média para baixo sem significar nada.
create or replace view vw_dashboard as
select
  (select count(*) from instituicao where status = 'ativa')   as instituicoes_ativas,
  (select count(*) from instituicao where status = 'inativa') as instituicoes_inativas,
  (select count(*) from instituicao
     where status in ('em_processo_entrada','em_processo_saida')) as instituicoes_em_processo,
  (select count(*) from vinculo where status = 'ativo')       as representantes_ativos,
  (select count(*) from reuniao where status = 'encerrada')   as reunioes_realizadas,
  (select round(avg(percentual_comparecimento), 1)
     from vw_resumo_reuniao where status = 'encerrada')       as media_presenca,
  -- ↓ coluna nova da 002: alimenta o bloco "Próximas reuniões"
  (select count(*) from reuniao
     where status = 'agendada' and data >= current_date)      as reunioes_agendadas;

-- =============================================================================
-- PARTE 8 — Controle de acesso das tabelas novas
-- Sem isto, tabela nova nasce sem RLS e vira a porta destrancada da casa.
-- =============================================================================

alter table area_atuacao    enable row level security;
alter table reuniao_convite enable row level security;
alter table notificacao     enable row level security;
alter table log_auditoria   enable row level security;

-- Mesmo padrão da 001: autenticado lê, admin e gestor escrevem, só admin exclui.
do $$
declare t text;
begin
  foreach t in array array['area_atuacao','reuniao_convite']
  loop
    execute format(
      'create policy %I_ler on %I for select
         using (usuario_atual_id() is not null)', t, t);
    execute format(
      'create policy %I_inserir on %I for insert
         with check (papel_atual() in (''admin'',''gestor''))', t, t);
    execute format(
      'create policy %I_atualizar on %I for update
         using (papel_atual() in (''admin'',''gestor''))
         with check (papel_atual() in (''admin'',''gestor''))', t, t);
    execute format(
      'create policy %I_excluir on %I for delete
         using (papel_atual() = ''admin'')', t, t);
  end loop;
end $$;

-- Notificação é pessoal: ninguém lê a do outro, nem o admin pela via normal.
create policy notificacao_ler_propria on notificacao
  for select using (usuario_id = usuario_atual_id());
create policy notificacao_marcar_lida on notificacao
  for update using (usuario_id = usuario_atual_id())
              with check (usuario_id = usuario_atual_id());
create policy notificacao_criar on notificacao
  for insert with check (papel_atual() in ('admin','gestor'));
create policy notificacao_apagar_propria on notificacao
  for delete using (usuario_id = usuario_atual_id() or papel_atual() = 'admin');

-- Log de auditoria: só admin lê, e ninguém escreve pela via normal — quem
-- grava é a trigger, que roda como dono. Log que a aplicação pode editar não
-- serve como log.
create policy log_auditoria_admin_le on log_auditoria
  for select using (papel_atual() = 'admin');

-- ---------------------------------------------------------- nome do autor
-- As telas de detalhe mostram "Cadastrada por: Administrador Kauan". A política
-- usuario_ler_proprio impede um gestor de ler a linha de outro usuário — o que
-- está certo para a tabela, mas deixaria a tela sem o nome.
--
-- Esta view roda com o privilégio do DONO (security_invoker fica desligado, que
-- é o padrão do PostgreSQL), então enxerga a tabela inteira. O que ela expõe é
-- só id, nome e papel: nunca e-mail, nunca senha_hash, nunca último login.
create view vw_usuario_publico as
  select id, nome, papel, ativo from usuario;

comment on view vw_usuario_publico is
  'Apenas para exibir autoria (criado_por / atualizado_por). Não acrescentar '
  'coluna aqui sem pensar: o que entra fica visível para todo usuário logado.';

grant select on vw_usuario_publico to app_web;

grant select, insert, update, delete
  on area_atuacao, reuniao_convite, notificacao to app_web;
grant select on log_auditoria to app_web;
grant usage, select on sequence area_atuacao_id_seq   to app_web;
grant usage, select on sequence log_auditoria_id_seq  to app_web;
grant execute on function convidar_representantes_ativos(uuid) to app_web;

-- =============================================================================
-- PARTE 9 — Carga inicial das áreas de atuação
-- As três que o front citou, mais as que aparecem nas telas do protótipo.
-- =============================================================================

insert into area_atuacao (nome) values
  ('Educação'),
  ('Tecnologia da informação'),
  ('Saúde'),
  ('Agronegócio'),
  ('Indústria'),
  ('Serviços'),
  ('Meio ambiente e sustentabilidade'),
  ('Empreendedorismo e inovação'),
  ('Poder público');

commit;
