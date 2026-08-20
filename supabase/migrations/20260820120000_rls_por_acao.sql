-- Migration 009 — separar as políticas de escrita por ação
--
-- A migration 006 dava a admin e gestor uma política única "for all", o que
-- inclui DELETE. A matriz de permissões (lib/dominio/permissoes.ts) diz outra
-- coisa: gestor opera, mas não exclui — apagar uma instituição ou um vínculo
-- levaria junto o histórico de participação, que é o ativo do sistema.
--
-- Aqui o banco passa a dizer o mesmo que a aplicação.

do $$
declare t text;
begin
  foreach t in array array['tipo_instituicao','instituicao','instituicao_status_historico',
                           'pessoa','vinculo','reuniao','presenca','documento']
  loop
    execute format('drop policy if exists %I_escrita on %I', t, t);

    execute format(
      'create policy %I_inserir on %I for insert
         with check (papel_atual() in (''admin'',''gestor''))', t, t);

    execute format(
      'create policy %I_atualizar on %I for update
         using (papel_atual() in (''admin'',''gestor''))
         with check (papel_atual() in (''admin'',''gestor''))', t, t);

    -- exclusão: só administrador
    execute format(
      'create policy %I_excluir on %I for delete
         using (papel_atual() = ''admin'')', t, t);
  end loop;
end $$;

comment on function papel_atual() is
  'Papel do usuário autenticado. Espelha a matriz de lib/dominio/permissoes.ts — '
  'mudou lá, muda aqui.';
