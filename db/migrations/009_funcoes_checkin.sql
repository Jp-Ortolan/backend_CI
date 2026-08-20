-- =============================================================================
-- 009 — Check-in público por QR Code (RF26 a RF34)
--
-- O participante não tem conta, logo não existe usuário para o RLS avaliar.
-- Em vez de dar à aplicação uma chave que ignora todas as regras, o acesso
-- público passa por estas três funções: elas rodam com privilégio de dono, mas
-- fazem só o que está escrito, e toda a regra fica em um lugar auditável.
-- =============================================================================

-- Está aberto? Sem janela definida, vale o dia da reunião — assim uma reunião
-- cadastrada às pressas não fica com o check-in travado.
create or replace function checkin_aberto(r reuniao) returns boolean
language sql stable as $$
  select case
    when r.status in ('cancelada','encerrada') then false
    when r.checkin_abre_em  is not null and now() < r.checkin_abre_em  then false
    when r.checkin_fecha_em is not null and now() > r.checkin_fecha_em then false
    when r.checkin_abre_em is null and r.checkin_fecha_em is null
      then r.data = current_date
    else true
  end
$$;

-- ------------------------------------------------- dados públicos da reunião
create or replace function checkin_reuniao(p_token text)
returns table (titulo text, data date, hora_inicio time, local text,
               status status_reuniao, aberto boolean)
language sql stable security definer set search_path = public as $$
  select r.titulo, r.data, r.hora_inicio, r.local, r.status, checkin_aberto(r.*)
  from reuniao r
  where r.qr_token = p_token
$$;

-- ------------------------------------------------------- busca de participante
-- Só quem tem vínculo ativo aparece, no máximo 5 resultados. Devolver nome e
-- instituição de quem ainda não confirmou presença é uma exposição pequena mas
-- real; os dois limites dificultam varrer a base por este caminho.
create or replace function checkin_buscar(p_token text, p_termo text)
returns table (pessoa_id uuid, nome text, instituicao text,
               cargo text, vinculo_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare r reuniao;
begin
  select * into r from reuniao where qr_token = p_token;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if not checkin_aberto(r) then raise exception 'CHECKIN_FECHADO'; end if;
  if length(trim(p_termo)) < 3 then raise exception 'TERMO_CURTO'; end if;

  -- Casa quando TODAS as palavras digitadas aparecem no nome, em qualquer
  -- ordem. Quem digita "jose silva" encontra "José da Silva Júnior" — a busca
  -- por frase inteira não encontraria, por causa do "da" no meio.
  return query
  select p.id, p.nome, i.nome, v.cargo, v.id
  from vinculo v
  join pessoa p      on p.id = v.pessoa_id
  join instituicao i on i.id = v.instituicao_id
  where v.status = 'ativo'
    and (select bool_and(p.nome_busca like '%' || palavra || '%')
         from unnest(string_to_array(imutavel_unaccent(lower(trim(p_termo))), ' ')) palavra
         where palavra <> '')
  order by similarity(p.nome_busca, imutavel_unaccent(lower(trim(p_termo)))) desc, p.nome
  limit 5;
end $$;

-- ------------------------------------------------------- registro de presença
-- Passa p_pessoa_id para representante identificado; passa os dados livres para
-- convidado. Devolve o registro criado — ou o que já existia, se a pessoa já
-- tinha feito check-in (RF34): para ela isso é sucesso, não erro.
create or replace function checkin_registrar(
  p_token       text,
  p_pessoa_id   uuid    default null,
  p_nome        text    default null,
  p_email       text    default null,
  p_instituicao text    default null)
-- Os nomes de saída são propositalmente diferentes dos nomes das colunas:
-- dentro de uma função, um parâmetro de saída chamado "nome" sequestra
-- qualquer referência a uma coluna "nome" e o erro é difícil de enxergar.
returns table (out_presenca_id uuid, out_participante text, out_instituicao text,
               out_cargo text, out_tipo tipo_participante,
               out_registrado_em timestamptz, out_ja_existia boolean)
language plpgsql security definer set search_path = public as $$
declare
  r          reuniao;
  v          vinculo;
  v_pessoa   pessoa;
  v_inst     text;
  v_cargo    text;
  v_id       uuid;
  v_horario  timestamptz;
begin
  select * into r from reuniao where qr_token = p_token;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if r.status = 'cancelada' then raise exception 'REUNIAO_CANCELADA'; end if;
  if not checkin_aberto(r) then raise exception 'CHECKIN_FECHADO'; end if;

  -- ------------------------------------------------------------- convidado
  if p_pessoa_id is null then
    if p_nome is null or length(trim(p_nome)) < 3 then
      raise exception 'NOME_INVALIDO';
    end if;

    insert into presenca (reuniao_id, tipo, status, origem, horario_checkin,
                          nome_informado, email_informado, instituicao_informada)
    values (r.id, 'convidado', 'presente', 'qrcode', now(),
            trim(p_nome), nullif(trim(coalesce(p_email,'')), ''),
            nullif(trim(coalesce(p_instituicao,'')), ''))
    returning id, horario_checkin into v_id, v_horario;

    return query select v_id, trim(p_nome), nullif(trim(coalesce(p_instituicao,'')),''),
                        null::text, 'convidado'::tipo_participante, v_horario, false;
    return;
  end if;

  -- --------------------------------------------------------- representante
  select * into v_pessoa from pessoa pe where pe.id = p_pessoa_id;
  if not found then raise exception 'PESSOA_NAO_ENCONTRADA'; end if;

  -- Já registrou? Devolve o registro anterior em vez de falhar (RF34).
  select pr.id, pr.horario_checkin into v_id, v_horario
  from presenca pr where pr.reuniao_id = r.id and pr.pessoa_id = p_pessoa_id;

  if found then
    select i.nome, pr.cargo_no_momento into v_inst, v_cargo
    from presenca pr left join instituicao i on i.id = pr.instituicao_id
    where pr.id = v_id;

    return query select v_id, v_pessoa.nome, v_inst, v_cargo,
                        'representante'::tipo_participante, v_horario, true;
    return;
  end if;

  -- Vínculo válido NA DATA DA REUNIÃO, não o atual — é o snapshot (RF31).
  select * into v from vinculo vi
   where vi.pessoa_id = p_pessoa_id
     and vi.data_inicio <= r.data
     and (vi.data_fim is null or vi.data_fim >= r.data)
   order by (vi.status = 'ativo') desc, vi.data_inicio desc
   limit 1;

  if not found then raise exception 'VINCULO_INVALIDO'; end if;

  select i.nome into v_inst from instituicao i where i.id = v.instituicao_id;

  insert into presenca (reuniao_id, pessoa_id, vinculo_id, instituicao_id,
                        cargo_no_momento, tipo, status, origem, horario_checkin)
  values (r.id, p_pessoa_id, v.id, v.instituicao_id, v.cargo,
          'representante', 'presente', 'qrcode', now())
  returning id, horario_checkin into v_id, v_horario;

  return query select v_id, v_pessoa.nome, v_inst, v.cargo,
                      'representante'::tipo_participante, v_horario, false;
end $$;

grant execute on function
  checkin_reuniao(text),
  checkin_buscar(text, text),
  checkin_registrar(text, uuid, text, text, text)
to app_web;
