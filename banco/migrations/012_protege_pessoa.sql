-- =============================================================================
-- 012 — Pessoa com histórico não se exclui  ·  fix/compatibilidade-telas-legadas
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- O front passou a oferecer "Excluir representante" (DELETE /api/representantes/:id).
-- presenca.pessoa_id é "on delete set null": apagar a pessoa não daria erro —
-- tiraria o nome de quem esteve nas reuniões passadas, em silêncio. Mesmo
-- buraco que a 002 fechou na instituição e a 003 na reunião.
--
-- Excluir continua possível para o cadastro feito por engano: sem presença e
-- sem conta de acesso. O vínculo (e o convite) saem junto, em cascata, porque
-- sem presença eles não sustentam histórico nenhum.
-- =============================================================================

begin;

create or replace function tg_pessoa_protege_historico() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from presenca where pessoa_id = old.id) then
    raise exception 'PESSOA_COM_HISTORICO'
      using hint = 'Há presenças registradas. Encerre os vínculos em vez de excluir.';
  end if;
  if exists (select 1 from usuario where pessoa_id = old.id) then
    raise exception 'PESSOA_COM_CONTA'
      using hint = 'Há uma conta de acesso ligada a esta pessoa. Desligue a conta antes.';
  end if;
  return old;
end $$;

create trigger pessoa_protege_historico before delete on pessoa
  for each row execute function tg_pessoa_protege_historico();

commit;
