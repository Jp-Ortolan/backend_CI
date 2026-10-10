-- =============================================================================
-- 011 — Painel público (sem login)  ·  Revisão de outubro
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- "Ao acessar /dashboard sem login, o sistema redireciona para o login."
-- O redirecionamento é do front; o que faltava no back era DE ONDE o painel
-- público tiraria os dados. Sem usuário, o RLS não deixa ler nada — e é isso
-- que tem que continuar acontecendo com as TABELAS.
--
-- A saída é a mesma do check-in: funções SECURITY DEFINER que devolvem só o
-- que pode ser público, com a lista de colunas escrita à mão. Nenhuma devolve
-- CPF, e-mail ou telefone de pessoa; nenhuma devolve instituição que não
-- autorizou a divulgação; nenhum percentual é por pessoa.
--
--   publico_indicadores()          números gerais do ecossistema
--   publico_instituicoes(...)      lista com filtros por tipo, vertente e área
--   publico_logo(id)               os bytes da logo, se autorizada
--   publico_agenda(de, ate)        reuniões e eventos marcados como públicos
--   publico_diretoria()            composição atual da Diretoria
--   publico_documentos()           Regimento, planejamento, atas aprovadas
--   publico_documento_conteudo(id) os bytes de um documento público
--   publico_configuracao()         links: manifestação de interesse, Linktree
--
-- E a tabela `configuracao`, onde o admin guarda esses links.
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — Configuração (links e canais oficiais)
-- =============================================================================

create table configuracao (
  chave       text primary key,
  valor       jsonb not null,
  -- Só o que está marcado como público sai pela rota sem login.
  publico     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references usuario(id) on delete set null
);

create trigger configuracao_touch before update on configuracao
  for each row execute function tg_touch_updated_at();

insert into configuracao (chave, valor, publico) values
  ('link_manifestacao_interesse', 'null'::jsonb, true),
  ('linktree',                    'null'::jsonb, true),
  -- Lista de {nome, url}: Instagram, site, YouTube...
  ('canais_oficiais',             '[]'::jsonb,   true);

alter table configuracao enable row level security;

create policy configuracao_ler on configuracao for select
  using (usuario_atual_id() is not null);
create policy configuracao_admin_inserir on configuracao for insert
  with check (papel_atual() = 'admin');
create policy configuracao_admin_atualizar on configuracao for update
  using (papel_atual() = 'admin') with check (papel_atual() = 'admin');

grant select, insert, update on configuracao to app_web;

-- =============================================================================
-- PARTE 2 — Indicadores gerais
-- Mesmas fórmulas das views (média = percentual OFICIAL de comparecimento),
-- mas calculadas aqui como dono — a view, com security_invoker, devolveria
-- zero para quem não tem login.
-- =============================================================================

create or replace function publico_indicadores()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'instituicoesIntegrantes',
      (select count(*) from instituicao where status = 'ativa'),
    'representantesAtivos',
      (select count(*) from vinculo v join instituicao i on i.id = v.instituicao_id
        where v.status = 'ativo' and i.status = 'ativa'),
    'reunioesRealizadas',
      (select count(*) from reuniao where status = 'encerrada' and natureza = 'reuniao'),
    'eventosRealizados',
      (select count(*) from reuniao where status = 'encerrada' and natureza = 'evento'),
    'proximasAtividades',
      (select count(*) from reuniao
        where status in ('agendada', 'em_andamento') and data >= current_date and exibir_publico),
    -- Percentual geral: média do comparecimento oficial das reuniões encerradas
    -- dos últimos 12 meses. Nenhum nome, nenhuma pessoa.
    'percentualParticipacao',
      (select round(avg(x.pct), 1) from (
         select 100.0 * count(*) filter (where pr.status = 'presente' and pr.tipo = 'representante')
                / nullif((select count(*) from vinculo v
                           where v.data_inicio <= r.data
                             and (v.data_fim is null or v.data_fim >= r.data)), 0) as pct
           from reuniao r
           left join presenca pr on pr.reuniao_id = r.id
          where r.status = 'encerrada' and r.conta_participacao
            and r.data >= current_date - interval '12 months'
          group by r.id) x),
    'porTipo', coalesce((
      select jsonb_agg(jsonb_build_object('nome', t.nome, 'total', x.total) order by x.total desc, t.nome)
        from (select tipo_instituicao_id, count(*) as total from instituicao
               where status = 'ativa' group by tipo_instituicao_id) x
        join tipo_instituicao t on t.id = x.tipo_instituicao_id), '[]'::jsonb),
    'porVertente', coalesce((
      select jsonb_agg(jsonb_build_object('nome', ve.nome, 'total', x.total) order by x.total desc, ve.nome)
        from (select vertente_id, count(*) as total from instituicao
               where status = 'ativa' group by vertente_id) x
        join vertente ve on ve.id = x.vertente_id), '[]'::jsonb),
    'porArea', coalesce((
      select jsonb_agg(jsonb_build_object('nome', a.nome, 'total', x.total) order by x.total desc, a.nome)
        from (select area_atuacao_id, count(*) as total from instituicao
               where status = 'ativa' group by area_atuacao_id) x
        join area_atuacao a on a.id = x.area_atuacao_id), '[]'::jsonb)
  )
$$;

-- =============================================================================
-- PARTE 3 — Instituições e logos
-- =============================================================================

create or replace function publico_instituicoes(
  p_tipo     smallint default null,
  p_vertente smallint default null,
  p_area     smallint default null,
  p_busca    text     default null)
returns table (id uuid, nome text, nome_fantasia text, tipo text, vertente text,
               area text, cidade text, uf char(2), site text, descricao text,
               redes_sociais jsonb, data_entrada date, tem_logo boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.nome, i.nome_fantasia, t.nome, ve.nome, a.nome,
         i.cidade, i.uf, i.site, i.descricao, i.redes_sociais, i.data_entrada,
         (i.autoriza_logo and i.logo_documento_id is not null)
    from instituicao i
    left join tipo_instituicao t on t.id = i.tipo_instituicao_id
    left join vertente        ve on ve.id = i.vertente_id
    left join area_atuacao     a on a.id = i.area_atuacao_id
   where i.status = 'ativa'
     and i.autoriza_divulgacao
     and (p_tipo     is null or i.tipo_instituicao_id = p_tipo)
     and (p_vertente is null or i.vertente_id = p_vertente)
     and (p_area     is null or i.area_atuacao_id = p_area)
     and (p_busca    is null or i.nome_busca like '%' || imutavel_unaccent(lower(p_busca)) || '%')
   order by i.nome
$$;

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
     -- Logo só imagem: um PDF marcado como logo não sai por aqui.
     and d.mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
$$;

-- =============================================================================
-- PARTE 4 — Agenda e Diretoria
-- =============================================================================

create or replace function publico_agenda(p_de date default current_date, p_ate date default null)
returns table (id uuid, titulo text, natureza natureza_atividade, tipo text, numero integer,
               data date, hora_inicio time, hora_fim time, local text, endereco text,
               modalidade modalidade_atividade, organizacao_responsavel text,
               evento_proprio boolean, inscricao_url text, descricao text, status status_reuniao)
language sql stable security definer set search_path = public as $$
  select r.id, r.titulo, r.natureza, t.nome, r.numero,
         r.data, r.hora_inicio, r.hora_fim, r.local, r.endereco,
         r.modalidade, r.organizacao_responsavel, r.evento_proprio, r.inscricao_url,
         r.descricao, r.status
    from reuniao r
    left join tipo_atividade t on t.id = r.tipo_atividade_id
   where r.exibir_publico
     and r.status in ('agendada', 'em_andamento', 'encerrada')
     and r.data >= coalesce(p_de, current_date)
     and (p_ate is null or r.data <= p_ate)
   order by r.data, r.hora_inicio nulls last
   limit 200
$$;

-- Composição da Diretoria: quem tem cargo no Fórum num vínculo ativo. Sai só
-- nome, cargo e instituição — é informação institucional, publicada pelo
-- próprio Fórum. Nunca e-mail, telefone ou CPF.
create or replace function publico_diretoria()
returns table (nome text, cargo_forum text, instituicao text)
language sql stable security definer set search_path = public as $$
  select p.nome, v.cargo_forum, i.nome
    from vinculo v
    join pessoa p      on p.id = v.pessoa_id
    join instituicao i on i.id = v.instituicao_id
   where v.status = 'ativo'
     and v.cargo_forum is not null
     and i.status = 'ativa'
   order by v.cargo_forum, p.nome
$$;

-- =============================================================================
-- PARTE 5 — Documentos públicos
-- =============================================================================

create or replace function publico_documentos()
returns table (id uuid, nome text, descricao text, tipo text, origem text,
               url_externa text, mime_type text, tamanho_bytes bigint,
               versao integer, publicado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, d.nome, d.descricao, d.tipo,
         case when d.url_externa is not null then 'link' else 'arquivo' end,
         d.url_externa, d.mime_type, d.tamanho_bytes, d.versao, d.created_at
    from documento d
   where d.visibilidade = 'publico'
     -- Versão substituída sai da lista pública: fica só a vigente.
     and not exists (select 1 from documento n where n.substitui_id = d.id)
   order by d.tipo nulls last, d.nome
$$;

create or replace function publico_documento_conteudo(p_documento_id uuid)
returns table (nome text, mime_type text, conteudo bytea)
language sql stable security definer set search_path = public as $$
  select d.nome, d.mime_type, c.conteudo
    from documento d
    join documento_conteudo c on c.documento_id = d.id
   where d.id = p_documento_id
     and d.visibilidade = 'publico'
$$;

create or replace function publico_configuracao()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(chave, valor), '{}'::jsonb)
    from configuracao where publico
$$;

-- Opções dos filtros do painel (tipo, vertente, área): listas de domínio, sem
-- dado de ninguém. As tabelas pedem login pelo RLS; a função não.
create or replace function publico_filtros()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tiposInstituicao', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome)
                                    from tipo_instituicao where ativo), '[]'::jsonb),
    'vertentes',        coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome)
                                    from vertente where ativo), '[]'::jsonb),
    'areasAtuacao',     coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome)
                                    from area_atuacao where ativo), '[]'::jsonb)
  )
$$;

grant execute on function
  publico_filtros(),
  publico_indicadores(),
  publico_instituicoes(smallint, smallint, smallint, text),
  publico_logo(uuid),
  publico_agenda(date, date),
  publico_diretoria(),
  publico_documentos(),
  publico_documento_conteudo(uuid),
  publico_configuracao()
to app_web;

commit;
