-- =============================================================================
-- SEED — dados de exemplo para desenvolvimento e teste
--
-- Rodado automaticamente pelo "supabase db reset".
-- NUNCA aplicar em produção.
--
-- Cenário montado para exercitar a decisão central da modelagem: uma pessoa
-- que troca de instituição sem que o histórico anterior se perca.
-- =============================================================================

-- ------------------------------------------------------------------ usuários
-- A senha de todos os usuários de exemplo é: senha123456
-- (hash Argon2id — o banco nunca vê a senha em texto puro)
insert into usuario (id, nome, email, papel, senha_hash) values
  ('11111111-1111-1111-1111-111111111111', 'Ana Gestora',   'ana@centroinovacao.br',   'admin',   '$argon2id$v=19$m=19456,t=2,p=1$VuCNQ3Gkqb/O19nORm+0Qg$+To+3Te2b/kRXtRdI8hWrPQ0t2GoZhHdW6GlNwRedsw'),
  ('11111111-1111-1111-1111-111111111112', 'Bruno Leitura', 'bruno@centroinovacao.br', 'leitura', '$argon2id$v=19$m=19456,t=2,p=1$VuCNQ3Gkqb/O19nORm+0Qg$+To+3Te2b/kRXtRdI8hWrPQ0t2GoZhHdW6GlNwRedsw'),
  ('11111111-1111-1111-1111-111111111113', 'Carla Gestora', 'carla@centroinovacao.br', 'gestor',  '$argon2id$v=19$m=19456,t=2,p=1$VuCNQ3Gkqb/O19nORm+0Qg$+To+3Te2b/kRXtRdI8hWrPQ0t2GoZhHdW6GlNwRedsw');

-- -------------------------------------------------------------- instituições
insert into instituicao (id, nome, cnpj, tipo_instituicao_id, cidade, uf, status, data_entrada, updated_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Universidade Alfa',    '11111111111111', 1, 'Campo Grande', 'MS', 'ativa',              '2019-03-01', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Startup Beta',         '22222222222222', 3, 'Campo Grande', 'MS', 'ativa',              '2025-06-01', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Prefeitura Municipal', '33333333333333', 5, 'Campo Grande', 'MS', 'ativa',              '2019-03-01', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Instituto Gama',       '44444444444444', 2, 'Dourados',     'MS', 'em_processo_entrada', null,        '11111111-1111-1111-1111-111111111111');

-- instituição que saiu do ecossistema
insert into instituicao (id, nome, cnpj, tipo_instituicao_id, cidade, uf, status, data_entrada, data_saida, updated_by) values
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Associação Delta', '55555555555555', 6, 'Três Lagoas', 'MS', 'inativa', '2019-03-01', '2024-12-31', '11111111-1111-1111-1111-111111111111');

-- -------------------------------------------------------------------- pessoas
insert into pessoa (id, nome, email, telefone) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'José da Silva Júnior', 'jose@alfa.br',    '(67) 99999-0001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Marina Gonçalves',     'marina@alfa.br',  '(67) 99999-0002'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'Carlos Antunes',       'carlos@pref.br',  '(67) 99999-0003');

-- -------------------------------------------------------------------- vínculos
-- José representou a Universidade Alfa até maio/2025 — vínculo ENCERRADO,
-- mas a linha permanece: é ela que segura o histórico daquele período.
insert into vinculo (id, pessoa_id, instituicao_id, cargo, status, data_inicio, data_fim) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Coordenador de Extensão', 'encerrado', '2019-03-01', '2025-05-31');

-- ...e desde junho/2025 representa a Startup Beta.
insert into vinculo (id, pessoa_id, instituicao_id, cargo, status, data_inicio) values
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'CTO', 'ativo', '2025-06-01'),
  ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Pró-reitora de Pesquisa', 'ativo', '2024-02-01'),
  ('cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000003', 'Secretário de Inovação', 'ativo', '2023-01-10');

-- -------------------------------------------------------------------- reuniões
insert into reuniao (id, titulo, data, hora_inicio, local, status, created_by) values
  ('dddddddd-0000-0000-0000-000000000001', 'Reunião Ordinária — Março/2025',    '2025-03-10', '09:00', 'Auditório do Centro', 'encerrada', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-0000-0000-0000-000000000002', 'Reunião Ordinária — Agosto/2025',   '2025-08-10', '09:00', 'Auditório do Centro', 'encerrada', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-0000-0000-0000-000000000003', 'Reunião Ordinária — Setembro/2025', '2025-09-10', '09:00', 'Auditório do Centro', 'encerrada', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-0000-0000-0000-000000000004', 'Reunião Ordinária — Setembro/2026', '2026-09-18', '09:00', 'Auditório do Centro', 'agendada',  '11111111-1111-1111-1111-111111111111');

-- ------------------------------------------------------------------- presenças
-- REPARE nas colunas de snapshot: em março/2025 o José marcou presença
-- PELA UNIVERSIDADE ALFA. Em agosto/2025, PELA STARTUP BETA.
-- Os dois registros continuam corretos para sempre.
insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id, cargo_no_momento, tipo, status, origem, horario_checkin) values
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Coordenador de Extensão', 'representante', 'presente', 'qrcode', '2025-03-10 09:02-03'),

  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003',
   'Secretário de Inovação', 'representante', 'presente', 'qrcode', '2025-03-10 09:07-03'),

  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'CTO', 'representante', 'presente', 'qrcode', '2025-08-10 09:05-03'),

  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Pró-reitora de Pesquisa', 'representante', 'presente', 'qrcode', '2025-08-10 09:11-03');

-- faltas registradas explicitamente
insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id, tipo, status, origem, registrado_por) values
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'representante', 'ausente', 'manual', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003',
   'representante', 'ausente', 'manual', '11111111-1111-1111-1111-111111111111');

insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id, cargo_no_momento, tipo, status, origem, horario_checkin) values
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Pró-reitora de Pesquisa', 'representante', 'presente', 'qrcode', '2025-09-10 09:03-03');

-- convidado: entrou pelo QR, não foi encontrado na base, se identificou na mão.
-- Repare que ele NÃO tem vinculo_id — a constraint do banco não deixaria.
insert into presenca (reuniao_id, tipo, status, origem, horario_checkin, nome_informado, email_informado, instituicao_informada) values
  ('dddddddd-0000-0000-0000-000000000002', 'convidado', 'presente', 'qrcode', '2025-08-10 09:20-03',
   'Patrícia Nogueira', 'patricia@empresax.com.br', 'Empresa X Tecnologia');

-- =============================================================================
-- CONFIRA O RESULTADO
--
--   select * from vw_dashboard;
--   select * from vw_participacao_representante order by representante;
--   select * from vw_participacao_instituicao   order by percentual_participacao desc;
--   select * from vw_resumo_reuniao             order by data;
--
-- O que olhar: José aparece DUAS vezes em vw_participacao_representante —
-- uma linha pela Universidade Alfa e outra pela Startup Beta, cada uma com o
-- percentual do período em que ele representou aquela instituição.
-- =============================================================================
