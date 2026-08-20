-- =============================================================================
-- 004 — Operação: reuniao, presenca, documento
-- =============================================================================

create table reuniao (
  id                uuid primary key default gen_random_uuid(),
  titulo            text not null,
  data              date not null,
  hora_inicio       time,
  hora_fim          time,
  local             text,
  descricao         text,
  pauta             text,
  status            status_reuniao not null default 'agendada',
  -- O QR aponta para /checkin/<qr_token>. Token aleatório, não o id da reunião:
  -- evita que alguém adivinhe a URL de outra reunião.
  qr_token          text not null unique default encode(gen_random_bytes(16), 'hex'),
  checkin_abre_em   timestamptz,
  checkin_fecha_em  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references usuario(id),
  constraint reuniao_horario_coerente
    check (hora_fim is null or hora_inicio is null or hora_fim > hora_inicio),
  constraint reuniao_janela_checkin_coerente
    check (checkin_fecha_em is null or checkin_abre_em is null or checkin_fecha_em > checkin_abre_em)
);
create index reuniao_data_idx   on reuniao (data desc);
create index reuniao_status_idx on reuniao (status);

-- presenca guarda SNAPSHOT do vínculo no momento do check-in. Sem isso, trocar
-- de instituição reescreveria o histórico das reuniões passadas.
create table presenca (
  id                    uuid primary key default gen_random_uuid(),
  reuniao_id            uuid not null references reuniao(id) on delete cascade,
  pessoa_id             uuid references pessoa(id) on delete set null,
  vinculo_id            uuid references vinculo(id) on delete set null,
  instituicao_id        uuid references instituicao(id) on delete set null,
  cargo_no_momento      text,
  tipo                  tipo_participante not null default 'representante',
  status                status_presenca   not null default 'presente',
  origem                origem_presenca   not null default 'qrcode',
  horario_checkin       timestamptz,
  nome_informado        text,
  email_informado       text,
  instituicao_informada text,
  observacoes           text,
  registrado_por        uuid references usuario(id),
  created_at            timestamptz not null default now(),
  constraint presenca_pessoa_unica unique (reuniao_id, pessoa_id),
  -- Convidado nunca carrega vínculo oficial (RF33).
  constraint presenca_convidado_sem_vinculo check (
       (tipo = 'representante' and pessoa_id is not null)
    or (tipo = 'convidado'     and vinculo_id is null and nome_informado is not null)
  ),
  constraint presenca_presente_tem_horario
    check (status <> 'presente' or horario_checkin is not null)
);
create index presenca_reuniao_idx     on presenca (reuniao_id);
create index presenca_pessoa_idx      on presenca (pessoa_id);
create index presenca_instituicao_idx on presenca (instituicao_id);

create table documento (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  descricao       text,
  tipo            text,
  storage_path    text not null unique,
  mime_type       text,
  tamanho_bytes   bigint,
  instituicao_id  uuid references instituicao(id) on delete cascade,
  reuniao_id      uuid references reuniao(id)     on delete cascade,
  enviado_por     uuid references usuario(id),
  created_at      timestamptz not null default now(),
  constraint documento_tem_dono
    check (instituicao_id is not null or reuniao_id is not null)
);
create index documento_instituicao_idx on documento (instituicao_id);
create index documento_reuniao_idx     on documento (reuniao_id);
