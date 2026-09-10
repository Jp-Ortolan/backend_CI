-- =============================================================================
-- 005 — Proteção do check-in público (RNF14)  ·  Semana 4, pendente
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- O QUE ESTAVA ABERTO
-- O contrato de API publica `MUITAS_TENTATIVAS` (429) desde a Semana 2, e o
-- código existe em src/dominio/erros.js. Só que nada nunca o levantava: as duas
-- rotas públicas do check-in aceitavam requisição sem limite nenhum.
--
-- POR QUE ISSO IMPORTA MAIS NA BUSCA DO QUE NO REGISTRO
-- `checkin_buscar` devolve nome, instituição e cargo de quem tem vínculo ativo.
-- É pouca exposição por consulta e muita se alguém varrer o alfabeto: em
-- algumas centenas de requisições sai a lista de representantes do ecossistema
-- inteiro. O limite de 5 resultados e o mínimo de 3 letras já dificultam;
-- o que faltava era impedir a repetição.
--
-- POR QUE NO BANCO, E NÃO EM MEMÓRIA
-- Contador em memória do processo zera a cada deploy e não é compartilhado
-- entre instâncias — no Railway, subir uma segunda réplica dobraria o limite
-- sem ninguém perceber. No banco o limite é o mesmo para todo mundo e sobrevive
-- a reinício.
--
-- O custo é uma linha gravada por tentativa. É barato para o volume desta
-- aplicação (algumas centenas de check-ins por reunião) e a limpeza é
-- automática.
-- =============================================================================

begin;

create table checkin_tentativa (
  id         bigserial primary key,
  -- Sem chave estrangeira para reuniao de propósito: token inválido também é
  -- tentativa, e é justamente o caso que mais interessa limitar.
  qr_token   text,
  ip         text not null,
  acao       text not null,
  criada_em  timestamptz not null default now()
);

-- O índice cobre exatamente a pergunta que a função faz: quantas tentativas
-- deste IP, nesta ação, desde tal instante.
create index checkin_tentativa_busca_idx
  on checkin_tentativa (ip, acao, criada_em desc);

comment on table checkin_tentativa is
  'Registro de tentativas no check-in público, para o limite por IP (RNF14). '
  'Não é log de auditoria: as linhas são descartáveis e a limpeza apaga as '
  'antigas a cada chamada.';

-- -----------------------------------------------------------------------------
-- Registra a tentativa e diz se ela passou do limite.
--
-- SECURITY DEFINER pelo mesmo motivo das outras funções de check-in: o
-- participante não tem usuário, então o RLS não teria o que avaliar.
--
-- Devolve a quantidade de tentativas na janela. Quem chama compara com o
-- limite — assim o mesmo mecanismo serve para limites diferentes por ação sem
-- precisar de outra função.
-- -----------------------------------------------------------------------------
create or replace function checkin_contar_tentativa(
  p_ip     text,
  p_acao   text,
  p_token  text default null,
  p_janela interval default interval '1 minute')
returns integer
language plpgsql security definer set search_path = public as $$
declare v_total integer;
begin
  -- Sem IP não dá para limitar por IP. Em vez de deixar passar em silêncio,
  -- trata como um único "desconhecido": mais restritivo, e visível no banco.
  p_ip := coalesce(nullif(trim(p_ip), ''), 'desconhecido');

  insert into checkin_tentativa (qr_token, ip, acao) values (p_token, p_ip, p_acao);

  select count(*) into v_total
    from checkin_tentativa t
   where t.ip = p_ip
     and t.acao = p_acao
     and t.criada_em > now() - p_janela;

  -- Limpeza oportunista: uma vez a cada ~100 chamadas, apaga o que passou de
  -- uma hora. Sem isso a tabela cresce para sempre; com agendador seria mais
  -- uma peça de infraestrutura para configurar e esquecer.
  if random() < 0.01 then
    delete from checkin_tentativa where criada_em < now() - interval '1 hour';
  end if;

  return v_total;
end $$;

grant execute on function checkin_contar_tentativa(text, text, text, interval) to app_web;

-- A tabela fica fechada ao acesso direto: quem escreve é a função, que roda
-- como dono. Mesma decisão de sessao e token_recuperacao na 001.
alter table checkin_tentativa enable row level security;

create policy checkin_tentativa_admin_le on checkin_tentativa
  for select using (papel_atual() = 'admin');

grant select on checkin_tentativa to app_web;

commit;
