-- =============================================================================
-- 008 — Perfis do Fórum e acesso por instituição  ·  Revisão de outubro
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- O QUE A REVISÃO APONTOU
-- "Os três usuários enxergam os mesmos menus." Era verdade no banco também: a
-- política de leitura de todas as tabelas era "qualquer usuário autenticado lê
-- tudo". Com admin, gestor e leitura isso fazia sentido — os três eram equipe
-- interna. Com o representante de instituição entrando no sistema, deixa de
-- fazer: ele não pode ler CPF, telefone e presença dos representantes das
-- outras 120 instituições.
--
-- O QUE MUDA
--   1. usuario ganha instituicao_id e pessoa_id: o representante é a conta DE
--      UMA instituição, e (opcionalmente) é também uma pessoa do cadastro.
--   2. Três funções curtas que as políticas usam: eh_gestao(),
--      instituicao_atual_id(), pessoa_atual_id().
--   3. As políticas de leitura das tabelas com dado pessoal passam a recortar
--      pela instituição do representante. Admin e Diretoria continuam vendo tudo.
--   4. O representante pode editar a PRÓPRIA instituição — mas só os campos de
--      contato. Nome, CNPJ e situação passam por solicitação (migration 009); a
--      trigger desta migration recusa no banco, mesmo que a aplicação esqueça.
--   5. Documento ganha visibilidade (interno / membros / público), versão e
--      "substitui", para ofício, termo de adesão, logo e documentos públicos.
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — A conta pertence a uma instituição
-- =============================================================================

alter table usuario
  add column instituicao_id uuid references instituicao(id) on delete set null,
  add column pessoa_id      uuid references pessoa(id)      on delete set null;

create index usuario_instituicao_idx on usuario (instituicao_id);

-- Uma pessoa do cadastro tem no máximo um acesso. Duas contas para a mesma
-- pessoa fariam o "minha presença" depender de qual das duas ela usou.
create unique index usuario_pessoa_unica on usuario (pessoa_id) where pessoa_id is not null;

comment on column usuario.instituicao_id is
  'Obrigatória para o perfil representante (conferido na aplicação). É ela que '
  'recorta o que o representante enxerga. Sem CHECK no banco de propósito: os '
  'acessos "leitura" antigos viraram representante sem instituição, e um CHECK '
  'impediria até o login deles (o login atualiza ultimo_login).';

-- =============================================================================
-- PARTE 2 — Funções que as políticas usam
-- SECURITY DEFINER porque leem `usuario`, que a política usuario_ler_proprio
-- fecharia. Devolvem só o id — nada mais sai daqui.
-- =============================================================================

create or replace function instituicao_atual_id() returns uuid
language sql stable security definer set search_path = public as $$
  select instituicao_id from usuario where id = usuario_atual_id() and ativo
$$;

create or replace function pessoa_atual_id() returns uuid
language sql stable security definer set search_path = public as $$
  select pessoa_id from usuario where id = usuario_atual_id() and ativo
$$;

-- "Gestão" = quem administra o Fórum: Administrador geral e Diretoria.
create or replace function eh_gestao() returns boolean
language sql stable as $$
  select coalesce(papel_atual() in ('admin', 'diretoria'), false)
$$;

grant execute on function instituicao_atual_id(), pessoa_atual_id(), eh_gestao() to app_web;

-- =============================================================================
-- PARTE 3 — Login e sessão devolvem a instituição
-- A lista de colunas de uma função não muda com CREATE OR REPLACE: é preciso
-- recriar. As permissões vão junto e são devolvidas logo abaixo.
-- =============================================================================

drop function auth_credenciais(text);
create function auth_credenciais(p_email text)
returns table (id uuid, nome text, email text, senha_hash text,
               papel papel_usuario, ativo boolean,
               instituicao_id uuid, pessoa_id uuid)
language sql stable security definer set search_path = public as $$
  select u.id, u.nome, u.email, u.senha_hash, u.papel, u.ativo,
         u.instituicao_id, u.pessoa_id
  from usuario u
  where u.email = lower(trim(p_email))
$$;

-- Devolve também expira_em: a aplicação renova a sessão de quem está usando o
-- sistema (ver auth_renovar_sessao), em vez de derrubar no meio de uma reunião.
drop function auth_ler_sessao(text);
create function auth_ler_sessao(p_token_hash text)
returns table (id uuid, nome text, email text, papel papel_usuario, ativo boolean,
               instituicao_id uuid, pessoa_id uuid, expira_em timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.nome, u.email, u.papel, u.ativo, u.instituicao_id, u.pessoa_id, s.expira_em
  from sessao s
  join usuario u on u.id = s.usuario_id
  where s.token_hash = p_token_hash
    and s.expira_em > now()
    and u.ativo
$$;

-- Renovação deslizante: só estende, nunca encurta, e só sessão ainda válida.
-- Sessão vencida não ressuscita por aqui — precisa de login.
create or replace function auth_renovar_sessao(p_token_hash text, p_expira_em timestamptz)
returns void
language sql security definer set search_path = public as $$
  update sessao
     set expira_em = p_expira_em
   where token_hash = p_token_hash
     and expira_em > now()
     and expira_em < p_expira_em
$$;

-- Mudou o perfil ou a instituição de alguém, ou desativou a conta: as sessões
-- abertas daquela pessoa caem, para ela não continuar com a permissão antiga.
-- Só o admin chama (a função confere), porque sessão não tem política de RLS.
create or replace function auth_encerrar_sessoes_do_usuario(p_usuario_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_total integer;
begin
  if papel_atual() is distinct from 'admin' then
    raise exception 'SEM_PERMISSAO_CONTA';
  end if;
  delete from sessao where usuario_id = p_usuario_id;
  get diagnostics v_total = row_count;
  return v_total;
end $$;

grant execute on function
  auth_credenciais(text), auth_ler_sessao(text),
  auth_renovar_sessao(text, timestamptz),
  auth_encerrar_sessoes_do_usuario(uuid)
to app_web;

-- =============================================================================
-- PARTE 4 — Documento: visibilidade, versão e documento sem dono
-- =============================================================================

create type visibilidade_documento as enum ('interno', 'membros', 'publico');

alter table documento
  add column visibilidade visibilidade_documento not null default 'interno',
  add column versao       integer not null default 1,
  add column substitui_id uuid references documento(id) on delete set null;

alter table documento
  add constraint documento_versao_positiva check (versao >= 1);

comment on column documento.visibilidade is
  'interno: Admin, Diretoria e a própria instituição. membros: todo usuário '
  'logado (convocação, ata). publico: aparece no painel público, sem login '
  '(Regimento, planejamento, atas aprovadas).';
comment on column documento.substitui_id is
  'Versão anterior deste mesmo documento. Substituir não apaga: o ofício antigo '
  'continua no histórico, só deixa de ser o vigente.';

-- O que já existia anexado a reunião era material da reunião: membros veem.
update documento set visibilidade = 'membros' where reuniao_id is not null;

-- Documento do Fórum (Regimento, planejamento) não é de instituição nem de
-- reunião. Ele pode existir sem dono, desde que seja público.
alter table documento drop constraint documento_tem_dono;
alter table documento add constraint documento_tem_dono
  check (instituicao_id is not null or reuniao_id is not null or visibilidade = 'publico');

-- =============================================================================
-- PARTE 5 — Políticas de leitura recortadas pela instituição
--
-- Regra geral: eh_gestao() vê tudo. O representante vê o que é da instituição
-- dele (e o que é dele mesmo, como pessoa). Instituição e reunião continuam
-- legíveis por todo usuário logado: o Fórum é público entre os membros, e o
-- painel público mostra até para quem não tem login.
--
-- Políticas permissivas se somam (OR). Por isso a de leitura antiga precisa
-- SAIR — deixar a velha e criar a nova não restringiria nada.
-- =============================================================================

-- ------------------------------------------------------------ instituição
-- Leitura continua aberta a todo autenticado (consultar instituições é ✅ para
-- todos). Os campos internos (observações) quem esconde é a aplicação.
-- Edição: a gestão edita qualquer uma; o representante, só a dele.
drop policy instituicao_atualizar on instituicao;
create policy instituicao_atualizar on instituicao for update
  using (eh_gestao() or (papel_atual() = 'representante' and id = instituicao_atual_id()))
  with check (eh_gestao() or (papel_atual() = 'representante' and id = instituicao_atual_id()));

drop policy instituicao_status_historico_ler on instituicao_status_historico;
create policy instituicao_status_historico_ler on instituicao_status_historico for select
  using (eh_gestao() or instituicao_id = instituicao_atual_id());

-- ------------------------------------------------------------ pessoa
drop policy pessoa_ler on pessoa;
create policy pessoa_ler on pessoa for select
  using (
    eh_gestao()
    or id = pessoa_atual_id()
    or exists (select 1 from vinculo v
                where v.pessoa_id = pessoa.id
                  and v.instituicao_id = instituicao_atual_id())
  );

-- O representante atualiza os próprios contatos (a trigger da Parte 6 limita
-- QUAIS campos).
drop policy pessoa_atualizar on pessoa;
create policy pessoa_atualizar on pessoa for update
  using (eh_gestao() or id = pessoa_atual_id())
  with check (eh_gestao() or id = pessoa_atual_id());

-- ------------------------------------------------------------ vínculo
drop policy vinculo_ler on vinculo;
create policy vinculo_ler on vinculo for select
  using (eh_gestao()
         or instituicao_id = instituicao_atual_id()
         or pessoa_id = pessoa_atual_id());

-- ------------------------------------------------------------ reunião
-- Rascunho é trabalho interno da Diretoria; publicada, todo membro vê.
drop policy reuniao_ler on reuniao;
create policy reuniao_ler on reuniao for select
  using (eh_gestao() or (usuario_atual_id() is not null and status <> 'rascunho'));

-- ------------------------------------------------------------ presença
-- "Visualizar listas nominais: da própria instituição."
drop policy presenca_ler on presenca;
create policy presenca_ler on presenca for select
  using (eh_gestao()
         or instituicao_id = instituicao_atual_id()
         or pessoa_id = pessoa_atual_id());

-- ------------------------------------------------------------ convite
drop policy reuniao_convite_ler on reuniao_convite;
create policy reuniao_convite_ler on reuniao_convite for select
  using (eh_gestao()
         or instituicao_id = instituicao_atual_id()
         or pessoa_id = pessoa_atual_id());

-- ------------------------------------------------------------ documento
drop policy documento_ler on documento;
create policy documento_ler on documento for select
  using (
    eh_gestao()
    or visibilidade = 'publico'
    or (usuario_atual_id() is not null and visibilidade = 'membros')
    or (instituicao_id is not null and instituicao_id = instituicao_atual_id())
  );

-- "Enviar ofício e logo: apenas da própria instituição." O representante anexa
-- à instituição dele, nunca a reunião, e nunca como documento público.
drop policy documento_inserir on documento;
create policy documento_inserir on documento for insert
  with check (
    eh_gestao()
    or (papel_atual() = 'representante'
        and instituicao_id = instituicao_atual_id()
        and reuniao_id is null
        and visibilidade = 'interno')
  );

drop policy documento_conteudo_inserir on documento_conteudo;
create policy documento_conteudo_inserir on documento_conteudo for insert
  with check (
    eh_gestao()
    or exists (select 1 from documento d
                where d.id = documento_id
                  and d.instituicao_id = instituicao_atual_id())
  );

-- ------------------------------------------------------------ auditoria
-- Histórico de alterações: a gestão lê tudo; o representante, o da instituição
-- dele (a aba "Histórico" da área da instituição).
drop policy log_auditoria_admin_le on log_auditoria;
create policy log_auditoria_ler on log_auditoria for select
  using (eh_gestao()
         or (entidade = 'instituicao' and registro_id = instituicao_atual_id()::text));

-- =============================================================================
-- PARTE 6 — Guardas: o que o representante não muda nem pela porta dos fundos
--
-- A política diz QUAIS LINHAS ele pode atualizar; não diz QUAIS COLUNAS. Sem a
-- trigger, um PATCH direto na API trocaria o CNPJ ou se aprovaria sozinho.
-- =============================================================================

create or replace function tg_instituicao_guarda_representante() returns trigger
language plpgsql as $$
declare
  -- Campos que o representante altera direto, sem aprovação ("Área da
  -- instituição": telefone, e-mail, endereço, redes sociais, logo...).
  livres text[] := array[
    'email', 'telefone', 'site',
    'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'complemento',
    'descricao', 'redes_sociais', 'contatos_comunicacao',
    'logo_documento_id', 'autoriza_divulgacao', 'autoriza_logo',
    'updated_at', 'updated_by', 'nome_busca'];
  -- Enquanto a instituição ainda está se cadastrando, não há o que proteger:
  -- ela preenche nome, CNPJ e classificação ela mesma. Só não mexe no que é
  -- decisão da gestão.
  da_gestao text[] := array[
    'status', 'data_entrada', 'data_saida', 'observacoes',
    'motivo_saida', 'substituida_por_id', 'created_by', 'created_at'];
  preenchendo boolean;
begin
  if papel_atual() is distinct from 'representante' then
    return new;
  end if;

  preenchendo := old.status in ('rascunho', 'aguardando_documentos', 'ajustes_solicitados');

  -- Situação: o representante só ENVIA para análise. Aprovar é da gestão.
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
    -- 'status' fica de fora: a transição já foi conferida logo acima.
    if exists (
         select 1 from unnest(da_gestao) c
          where c <> 'status'
            and (to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c))
    then
      raise exception 'ALTERACAO_EXIGE_APROVACAO'
        using hint = 'Datas de entrada e saída e observações internas são da Diretoria.';
    end if;
  else
    if (to_jsonb(new) - livres) is distinct from (to_jsonb(old) - livres) then
      raise exception 'ALTERACAO_EXIGE_APROVACAO'
        using hint = 'Nome, CNPJ, classificação e situação mudam por solicitação.';
    end if;
  end if;

  return new;
end $$;

-- A linha do histórico de situação é gravada pela trigger da 001. Quando quem
-- muda a situação é o representante (enviar para análise), a política de
-- INSERT do histórico — só gestão — recusaria a linha e travaria o envio.
-- A trigger passa a rodar como dono, como a de auditoria: ela grava só o que
-- está escrito nela, e a guarda acima já decidiu se a mudança podia acontecer.
create or replace function tg_registra_status_instituicao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into instituicao_status_historico
      (instituicao_id, status_anterior, status_novo, alterado_por)
    values (new.id,
            case when tg_op = 'INSERT' then null else old.status end,
            new.status,
            coalesce(new.updated_by, usuario_atual_id()));
  end if;
  return new;
end $$;

create trigger instituicao_guarda_representante before update on instituicao
  for each row execute function tg_instituicao_guarda_representante();

-- Pessoa: o representante atualiza os próprios contatos, e só eles.
create or replace function tg_pessoa_guarda_representante() returns trigger
language plpgsql as $$
declare
  livres text[] := array['email', 'telefone', 'autoriza_comunicacao',
                         'updated_at', 'nome_busca'];
begin
  if papel_atual() is distinct from 'representante' then
    return new;
  end if;
  if (to_jsonb(new) - livres) is distinct from (to_jsonb(old) - livres) then
    raise exception 'ALTERACAO_EXIGE_APROVACAO'
      using hint = 'Nome e CPF mudam por solicitação à Diretoria.';
  end if;
  return new;
end $$;

create trigger pessoa_guarda_representante before update on pessoa
  for each row execute function tg_pessoa_guarda_representante();

-- Usuário: a política usuario_admin_atualizar deixa cada um atualizar a própria
-- linha (para o login gravar ultimo_login, por exemplo). Sem esta guarda, um
-- representante poderia se promover a admin com um UPDATE.
create or replace function tg_usuario_guarda() returns trigger
language plpgsql as $$
begin
  -- Sem usuário declarado = função de login (SECURITY DEFINER) ou migration.
  if usuario_atual_id() is null or papel_atual() = 'admin' then
    return new;
  end if;
  if new.papel          is distinct from old.papel
  or new.ativo          is distinct from old.ativo
  or new.email          is distinct from old.email
  or new.instituicao_id is distinct from old.instituicao_id
  or new.pessoa_id      is distinct from old.pessoa_id then
    raise exception 'SEM_PERMISSAO_CONTA'
      using hint = 'Perfil, instituição e situação da conta são definidos pelo administrador.';
  end if;
  return new;
end $$;

create trigger usuario_guarda before update on usuario
  for each row execute function tg_usuario_guarda();

commit;
