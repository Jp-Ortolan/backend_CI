-- =============================================================================
-- 007 — Novos valores de enum  ·  Revisão de outubro (perfis do Fórum)
-- Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação
--
-- POR QUE ESTA MIGRATION É SEPARADA DAS OUTRAS
-- No PostgreSQL, valor acrescentado a um enum (ALTER TYPE ... ADD VALUE) só
-- pode ser USADO depois que a transação que o criou terminou. Se os valores
-- novos nascessem dentro da 008, que os usa em constraint e em política, a
-- migration quebraria com "unsafe use of new value".
--
-- Por isso este arquivo NÃO tem begin/commit: cada instrução roda sozinha e se
-- confirma na hora. Quando a 008 começa, os valores já existem.
--
-- RENOMEAR x ACRESCENTAR
-- Renomear (RENAME VALUE) preserva os dados: toda linha que era 'gestor' passa a
-- ser 'diretoria' sem UPDATE nenhum, e as políticas de RLS — que guardam o valor
-- do enum já interpretado, não o texto — continuam valendo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Perfis de acesso do Fórum
--
--   admin          → Administrador geral (sem mudança)
--   gestor         → diretoria: a Diretoria do Fórum faz o que o gestor fazia
--   leitura        → representante: o perfil de consulta genérico não existe no
--                    Fórum. Quem entra só para consultar é o representante de
--                    uma instituição, e enxerga o que é da instituição dele.
--   (público)      → continua sendo "sem login": não é papel de usuário.
-- -----------------------------------------------------------------------------
alter type papel_usuario rename value 'gestor'  to 'diretoria';
alter type papel_usuario rename value 'leitura' to 'representante';

-- -----------------------------------------------------------------------------
-- 2. Situação da instituição — o fluxo de cadastro pedido pelo Fórum
--
--   rascunho → aguardando_documentos → em_analise → ativa
--                                          ↓    ↑
--                                   ajustes_solicitados
--   ativa → em_processo_saida → inativa | desligada
--
-- 'em_processo_entrada' vira 'em_analise': é o mesmo momento ("pediu para
-- entrar e alguém precisa avaliar"), só com o nome que o Fórum usa.
-- 'desligada' é diferente de 'inativa': desligada saiu do Fórum de vez (por
-- pedido ou por decisão), inativa só está parada.
-- -----------------------------------------------------------------------------
alter type status_instituicao rename value 'em_processo_entrada' to 'em_analise';
alter type status_instituicao add value if not exists 'rascunho' before 'em_analise';
alter type status_instituicao add value if not exists 'aguardando_documentos' before 'em_analise';
alter type status_instituicao add value if not exists 'ajustes_solicitados' after 'em_analise';
alter type status_instituicao add value if not exists 'desligada';

-- -----------------------------------------------------------------------------
-- 3. Reunião/evento em rascunho: montada pela Diretoria, ainda não divulgada.
--    'agendada' continua sendo a publicada.
-- -----------------------------------------------------------------------------
alter type status_reuniao add value if not exists 'rascunho' before 'agendada';

-- -----------------------------------------------------------------------------
-- 4. Quem está na lista de presença: além do representante oficial e do
--    convidado, a equipe do Centro de Inovação — que está lá trabalhando e não
--    pode entrar na conta de participação das instituições.
-- -----------------------------------------------------------------------------
alter type tipo_participante add value if not exists 'equipe';
