-- =============================================================================
-- 003 — Proteção da reunião e apoio à lista de participantes  ·  Bloco B
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- 1. A 002 protegeu a instituição contra exclusão com histórico. A reunião
--    ficou com um buraco pior: presenca.reuniao_id e documento.reuniao_id são
--    "on delete cascade". Apagar uma reunião não dá erro nenhum — leva junto
--    TODAS as presenças e os documentos dela, em silêncio, e o indicador de
--    participação muda sem que ninguém saiba por quê.
--
--    Na instituição o risco era perder o nome; aqui é perder o fato.
--
-- 2. A tela de detalhe da reunião mostra convidados e presentes na mesma lista.
--    São duas tabelas com propósitos diferentes (ver docs/07), e juntá-las na
--    aplicação espalharia a mesma consulta por vários arquivos.
--    vw_reuniao_participante faz a junção num lugar só.
-- =============================================================================

begin;

-- =============================================================================
-- PARTE 1 — Reunião com histórico não se exclui, se cancela
--
-- Cancelar mantém a linha e o histórico; excluir só faz sentido para a reunião
-- criada por engano, que ainda não teve presença nem documento.
--
-- Convite NÃO impede a exclusão: convite é intenção, não fato. Uma reunião
-- marcada errado, com convites já disparados, pode ser apagada — o que não
-- pode sumir é quem esteve lá.
-- =============================================================================

create or replace function tg_reuniao_protege_historico() returns trigger
language plpgsql as $$
declare
  v_presencas  integer;
  v_documentos integer;
begin
  select count(*) into v_presencas  from presenca  where reuniao_id = old.id;
  select count(*) into v_documentos from documento where reuniao_id = old.id;

  if v_presencas > 0 then
    raise exception 'REUNIAO_COM_PRESENCA'
      using hint = 'Há presenças registradas. Cancele a reunião '
                   '(status = cancelada) em vez de excluir.';
  end if;

  if v_documentos > 0 then
    raise exception 'REUNIAO_COM_DOCUMENTO'
      using hint = 'Há documentos anexados. Remova os documentos antes, '
                   'ou cancele a reunião.';
  end if;

  return old;
end $$;

create trigger reuniao_protege_historico before delete on reuniao
  for each row execute function tg_reuniao_protege_historico();

-- =============================================================================
-- PARTE 2 — Lista de participantes da reunião
--
-- Um participante pode aparecer de três jeitos, e a tela mostra os três juntos:
--   convidado e compareceu    — convite + presença
--   convidado e não apareceu  — convite sem presença (ou presença 'ausente')
--   apareceu sem convite      — presença sem convite (o convidado avulso do QR)
--
-- O full join é o que permite os três. Um join comum perderia justamente as
-- duas pontas que mais interessam: quem faltou e quem chegou sem ser chamado.
-- =============================================================================

create view vw_reuniao_participante with (security_invoker = true) as
select
  coalesce(c.reuniao_id, p.reuniao_id)         as reuniao_id,
  c.id                                          as convite_id,
  p.id                                          as presenca_id,
  coalesce(c.pessoa_id, p.pessoa_id)            as pessoa_id,
  coalesce(c.vinculo_id, p.vinculo_id)          as vinculo_id,
  coalesce(c.instituicao_id, p.instituicao_id)  as instituicao_id,

  -- Para o representante o nome vem do cadastro; para o convidado avulso vem
  -- do que ele digitou no check-in, que é tudo o que existe sobre ele.
  coalesce(pe.nome, p.nome_informado)           as nome,
  coalesce(i.nome, p.instituicao_informada)     as instituicao,
  coalesce(p.cargo_no_momento, v.cargo)         as cargo,

  coalesce(p.tipo, 'representante')             as tipo,
  coalesce(c.status, 'pendente')                as status_confirmacao,
  c.respondido_em,
  p.status                                      as status_presenca,
  p.horario_checkin,
  p.origem                                      as origem_presenca
from reuniao_convite c
full join presenca p
  on p.reuniao_id = c.reuniao_id
 and p.pessoa_id  = c.pessoa_id
left join pessoa      pe on pe.id = coalesce(c.pessoa_id, p.pessoa_id)
left join instituicao i  on i.id  = coalesce(c.instituicao_id, p.instituicao_id)
left join vinculo     v  on v.id  = coalesce(c.vinculo_id, p.vinculo_id);

comment on view vw_reuniao_participante is
  'Convites e presenças de uma reunião na mesma lista. status_confirmacao vem '
  'do convite e status_presenca da presença: os dois podem ser null, e cada '
  'combinação significa uma coisa diferente na tela.';

grant select on vw_reuniao_participante to app_web;

-- =============================================================================
-- PARTE 3 — Fechar o desvio de RLS pelas views
--
-- O QUE ESTAVA ABERTO
-- No PostgreSQL, uma view roda com o privilégio de QUEM A CRIOU, não de quem a
-- consulta. Todas as views vieram da 001 e da 002, criadas pelo dono das
-- tabelas — e o dono ignora RLS. Na prática, `select * from vw_dashboard`
-- funcionava mesmo sem nenhum usuário declarado na transação, enquanto o mesmo
-- select na tabela devolvia zero linhas.
--
-- Hoje isso não vaza nada: a aplicação só consulta as views dentro de
-- comUsuario(), e o caminho público do check-in usa as funções checkin_*, que
-- nunca tocam nelas. O problema é a armadilha que fica armada — basta alguém
-- escrever uma consulta a uma view numa rota pública e ela responde, sem erro
-- nenhum para avisar que a regra de acesso foi contornada.
--
-- security_invoker faz a view ser avaliada com o privilégio de quem consulta,
-- então o RLS volta a valer. Requer PostgreSQL 15+, que já é o mínimo do
-- projeto.
--
-- A EXCEÇÃO, DE PROPÓSITO
-- vw_usuario_publico continua rodando como dono. Ela existe justamente para
-- furar a política usuario_ler_proprio e mostrar o nome de quem cadastrou —
-- e por isso expõe só id, nome, papel e ativo, nunca e-mail ou senha_hash.
-- =============================================================================

alter view vw_reuniao_esperada          set (security_invoker = true);
alter view vw_participacao_representante set (security_invoker = true);
alter view vw_participacao_instituicao  set (security_invoker = true);
alter view vw_resumo_reuniao            set (security_invoker = true);
alter view vw_dashboard                 set (security_invoker = true);

commit;
