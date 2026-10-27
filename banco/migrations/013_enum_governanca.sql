-- =============================================================================
-- 013 — Valores de enum do contrato /api/governanca  ·  feature/governanca-cadastros
--
-- Separada da 014 pelo mesmo motivo da 007: valor novo de enum só pode ser
-- usado depois que a transação que o criou terminou.
-- =============================================================================

-- Tipos de solicitação que as telas do front abrem (docs/contratos-complementares.md
-- do front): alteração cadastral livre (com aprovação), substituição e
-- encerramento de representante pelo vínculo, e análise de documento enviado
-- pela instituição (logo, ofício, termo).
alter type tipo_solicitacao add value if not exists 'alteracao_cadastral';
alter type tipo_solicitacao add value if not exists 'substituicao_representante';
alter type tipo_solicitacao add value if not exists 'encerramento_representante';
alter type tipo_solicitacao add value if not exists 'aprovacao_documento';
