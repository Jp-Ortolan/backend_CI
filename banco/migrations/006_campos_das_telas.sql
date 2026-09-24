-- =============================================================================
-- 006 — Campos que as telas do Figma pedem e o banco não tinha.
--
-- Conferido contra o arquivo do Figma em 24/09/2026: CPF no cadastro de
-- representante, link e senha no cadastro de reunião, e dois tipos de
-- instituição que aparecem no select e não existiam.
-- =============================================================================

-- --------------------------------------------------------------------------
-- CPF do representante
--
-- Guardamos só os 11 dígitos; a pontuação é decoração de tela, igual ao CNPJ.
-- Único, mas aceita nulo: as pessoas já cadastradas não têm CPF, e exigir
-- agora quebraria o que existe. A obrigatoriedade fica no formulário.
-- --------------------------------------------------------------------------
alter table pessoa add column cpf char(11);

alter table pessoa
  add constraint pessoa_cpf_digitos
    check (cpf is null or cpf ~ '^[0-9]{11}$');

create unique index pessoa_cpf_unico on pessoa (cpf) where cpf is not null;

comment on column pessoa.cpf is 'Só dígitos. O dígito verificador é conferido na aplicação (dominio/cpf.js).';

-- --------------------------------------------------------------------------
-- Reunião on-line: link e senha de acesso
--
-- A senha aqui é a da sala do Meet/Zoom, não credencial de usuário — por isso
-- fica em texto. A rota pública de check-in lê por checkin_reuniao(), que tem
-- lista fixa de colunas, então nem link nem senha passam por lá.
-- --------------------------------------------------------------------------
alter table reuniao
  add column link          text,
  add column senha_acesso  text;

alter table reuniao
  add constraint reuniao_link_http
    check (link is null or link ~* '^https?://');

comment on column reuniao.senha_acesso is 'Senha da sala on-line. Nunca exposta em rota pública.';

-- --------------------------------------------------------------------------
-- Tipos que o Figma mostra no select e não existiam
-- --------------------------------------------------------------------------
insert into tipo_instituicao (nome) values
  ('Faculdade'),
  ('Centro de inovação')
on conflict do nothing;
