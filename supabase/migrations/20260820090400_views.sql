-- Migration 005 — Views de consolidação (RF41 a RF48)
-- Nenhum indicador é gravado em coluna: todos derivam dos registros de presença.

-- Quais reuniões CADA VÍNCULO deveria ter participado.
-- Só conta reunião ocorrida dentro do período de vigência do vínculo (RF44) —
-- sem isso, quem entrou em 2025 apareceria com 0% nas reuniões de 2019.
create view vw_reuniao_esperada as
select v.id as vinculo_id, v.pessoa_id, v.instituicao_id,
       r.id as reuniao_id, r.data as reuniao_data
from vinculo v
join reuniao r
  on r.status = 'encerrada'
 and r.data >= v.data_inicio
 and (v.data_fim is null or r.data <= v.data_fim);

create view vw_participacao_representante as
select p.id as pessoa_id, p.nome as representante,
       i.id as instituicao_id, i.nome as instituicao,
       count(distinct e.reuniao_id) as reunioes_esperadas,
       count(distinct pr.reuniao_id) filter (where pr.status = 'presente') as presencas,
       count(distinct e.reuniao_id)
         - count(distinct pr.reuniao_id) filter (where pr.status = 'presente') as ausencias,
       round(100.0 * count(distinct pr.reuniao_id) filter (where pr.status = 'presente')
             / nullif(count(distinct e.reuniao_id), 0), 1) as percentual_participacao,
       max(pr.horario_checkin) as ultima_participacao
from pessoa p
join vinculo v     on v.pessoa_id = p.id
join instituicao i on i.id = v.instituicao_id
left join vw_reuniao_esperada e on e.vinculo_id = v.id
left join presenca pr on pr.pessoa_id = p.id and pr.reuniao_id = e.reuniao_id
group by p.id, p.nome, i.id, i.nome;

create view vw_participacao_instituicao as
select i.id as instituicao_id, i.nome as instituicao, i.status,
       count(distinct v.id) filter (where v.status = 'ativo') as representantes_ativos,
       count(distinct e.reuniao_id) as reunioes_esperadas,
       count(distinct pr.reuniao_id) filter (where pr.status = 'presente') as reunioes_com_presenca,
       round(100.0 * count(distinct pr.reuniao_id) filter (where pr.status = 'presente')
             / nullif(count(distinct e.reuniao_id), 0), 1) as percentual_participacao
from instituicao i
left join vinculo v on v.instituicao_id = i.id
left join vw_reuniao_esperada e on e.vinculo_id = v.id
left join presenca pr on pr.instituicao_id = i.id and pr.reuniao_id = e.reuniao_id
group by i.id, i.nome, i.status;

create view vw_resumo_reuniao as
select r.id as reuniao_id, r.titulo, r.data, r.status,
       count(pr.id) as total_registros,
       count(pr.id) filter (where pr.status = 'presente')  as presentes,
       count(pr.id) filter (where pr.status = 'ausente')   as ausentes,
       count(pr.id) filter (where pr.tipo   = 'convidado') as convidados,
       count(distinct pr.instituicao_id) as instituicoes_presentes,
       round(100.0 * count(pr.id) filter (where pr.status = 'presente')
             / nullif(count(pr.id), 0), 1) as percentual_presenca
from reuniao r
left join presenca pr on pr.reuniao_id = r.id
group by r.id, r.titulo, r.data, r.status;

create view vw_dashboard as
select
  (select count(*) from instituicao where status = 'ativa')   as instituicoes_ativas,
  (select count(*) from instituicao where status = 'inativa') as instituicoes_inativas,
  (select count(*) from instituicao
     where status in ('em_processo_entrada','em_processo_saida')) as instituicoes_em_processo,
  (select count(*) from vinculo where status = 'ativo')       as representantes_ativos,
  (select count(*) from reuniao where status = 'encerrada')    as reunioes_realizadas,
  (select round(avg(percentual_presenca), 1)
     from vw_resumo_reuniao where status = 'encerrada')        as media_presenca;
