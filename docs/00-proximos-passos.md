# Próximos passos — de 18/08 até a reunião de 27/08

Onde estamos: **terça, 18/08**, dia 6 da Semana 1. A reunião é **quinta, 20/08**,
e a Semana 2 (banco base e autenticação) começa no mesmo dia.

A Semana 1 do back-end está praticamente fechada — regras de negócio, entidades,
DER e perfis de acesso já existem. O que não começou é **DevOps** e **QA**, e são
justamente eles que precisam estar de pé antes da Semana 2, senão o back-end
trabalha sem lugar para publicar e sem quem valide.

---

## Até quinta, 20/08 (fechar a Semana 1)

### DevOps — 3 a 4 horas, é o caminho crítico

1. Criar o repositório no GitHub e subir este kit
2. Proteger `main` e `develop`: PR obrigatório e CI verde para merge
3. Criar os dois projetos Supabase (`ecossistema-homolog` e `ecossistema-prod`),
   região São Paulo
4. Cadastrar os secrets do GitHub (lista em `03-ambientes.md`)
5. Abrir um PR de teste só para ver o CI rodar do começo ao fim

O passo 5 é o que costuma ser pulado e é o que evita descobrir na quarta-feira
que o workflow nunca funcionou.

### QA — 2 a 3 horas

1. Ler o plano de testes e os 45 casos, e discordar do que estiver errado
2. Rodar `./scripts/testar-banco.sh` uma vez, para ver a saída dos 16 testes
   automatizados
3. Definir a ferramenta de acompanhamento (o `.csv` já está pronto para importar
   em planilha)
4. Fechar com a equipe a definição de pronto — é acordo, não imposição

### Back-end — 1 a 2 horas

1. Revisar as migrations deste kit (é o `schema.sql` já dividido em sete arquivos)
2. Levar as **seis perguntas em aberto** do documento do DER para a reunião:
   sem resposta, elas viram retrabalho na Semana 3
3. Combinar com o front-end o contrato de API (`04-contrato-de-api.md`) — ele
   precisa disso para trabalhar com mock enquanto as rotas não existem

### Na reunião de quinta

Mostrar: DER, requisitos, cronograma e o CI rodando. Levar as perguntas em
aberto e sair com decisão sobre elas.

---

## Semana 2 — 20/08 a 26/08

A semana mais carregada do cronograma. Só cabe porque o Supabase entrega
autenticação e RLS prontos — **não construir autenticação do zero.**

### Back-end (duas pessoas em paralelo)

| Quem | Entregar |
|---|---|
| Back-end A | Aplicar as migrations em homologação; conferir constraints e triggers no banco real; ajustar o que sair da reunião |
| Back-end B | Supabase Auth funcionando: login, recuperação de senha, tabela `usuario` sincronizada com `auth.users`; testar as policies com um usuário de cada perfil |

Um detalhe fácil de esquecer: criar um trigger em `auth.users` que insere a linha
correspondente em `usuario` com papel `leitura` por padrão. Sem isso, quem se
cadastra existe para o Auth e não existe para o sistema.

### DevOps

Deploy inicial na Vercel; variáveis de ambiente separadas por ambiente; primeiro
`supabase db push` para homologação; README validado por alguém que ainda não
subiu o projeto — se essa pessoa conseguir sozinha, a documentação está boa.

### QA

Ambiente de homologação de pé e casos CT01 a CT06 executados até quarta, para a
demo de quinta mostrar login funcionando de verdade.

---

## Quem depende de quem

```
DevOps cria repo e Supabase
        |
        +--> Back-end aplica migrations em homologação
        |            |
        |            +--> Back-end faz autenticação
        |                        |
        +--> QA monta homologação -----+--> QA testa login (CT01 a CT06)
```

O DevOps destrava todo mundo. Se atrasar, a Semana 2 inteira escorrega.

---

## O que não fazer agora

**Não aplicar migration em produção.** Homologação primeiro, sempre. O projeto de
produção só recebe migration depois que o QA aprovar em homologação.

**Não começar CRUD de instituição antes da autenticação funcionar.** Sem sessão e
sem perfil, o RLS bloqueia tudo e você vai depurar permissão achando que é bug de
consulta.

**Não editar as migrations deste kit depois que alguém já rodou.** A partir do
primeiro `db push` em homologação, mudança é migration nova.
