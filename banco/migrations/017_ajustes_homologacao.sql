-- =============================================================================
-- 017 — Ajustes da homologação  ·  fix/ajustes-homologacao
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
--   1. Fuso do banco em America/Sao_Paulo. O Railway sobe o Postgres em UTC, e
--      current_date virava o dia seguinte às 21h de Brasília: o check-in de
--      uma atividade do dia (sem janela definida) fechava três horas antes da
--      meia-noite, e "hoje" dos relatórios e da agenda ficava errado à noite.
--      Vale para as conexões novas (o deploy seguinte já abre conexões novas).
--
--   2. Auditoria sem ruído: cada login atualizava usuario.ultimo_login e
--      gerava uma linha "alteração" no Histórico. Agora ultimo_login e
--      versao_registro ficam fora do diff; um UPDATE que só mexe neles não
--      vira linha de log. As linhas antigas desse tipo NÃO são apagadas
--      (histórico não se edita): a consulta da auditoria é que as esconde.
-- =============================================================================

begin;

do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Sao_Paulo');
end $$;

-- Para esta própria sessão também (o que rodar depois na mesma migração).
set timezone to 'America/Sao_Paulo';

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
      -- updated_at e versao_registro mudam em toda gravação, nome_busca é
      -- derivado e ultimo_login muda a cada entrada no sistema: registrar
      -- qualquer um deles encheria o histórico de ruído.
      and campo.chave not in ('updated_at', 'nome_busca', 'ultimo_login', 'versao_registro');

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

commit;
