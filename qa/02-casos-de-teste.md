# Casos de teste — versão inicial

45 casos derivados do Documento de Requisitos. A coluna **Semana** indica
quando o caso se torna executável, segundo o cronograma.

Os casos de banco (constraints e cálculo de indicadores) já estão automatizados
em `tests/` e rodam no CI — não é preciso repeti-los manualmente. Esta lista
cobre o que só se verifica pela interface e pelo uso real.

## Como usar

Ao executar, registre em `qa/03-execucao.md` (ou na ferramenta que a equipe
escolher): data, ambiente, versão testada, resultado e, se falhou, o número da
issue aberta.

## Casos

| ID | RF | Título | Pré-condição | Passos | Resultado esperado | Prior. | Semana |
|---|---|---|---|---|---|---|---|
| CT01 | RF01 | Login com credenciais válidas | Usuário 'ana@centroinovacao.br' cadastrado e ativo | 1. Abrir /login  2. Informar e-mail e senha corretos  3. Confirmar | Acesso liberado e redirecionamento para o painel | Alta | 2 |
| CT02 | RF01 | Login com senha incorreta | Usuário cadastrado | 1. Informar e-mail correto e senha errada  2. Confirmar | Mensagem genérica de credencial inválida, sem informar se o e-mail existe | Alta | 2 |
| CT03 | RF02 | Recuperação de senha | Usuário cadastrado | 1. Clicar em 'esqueci a senha'  2. Informar o e-mail  3. Abrir o link recebido  4. Definir nova senha | Senha alterada e login funcionando com a nova senha | Alta | 2 |
| CT04 | RF03 | Perfil de consulta não edita | Usuário com papel 'leitura' autenticado | 1. Abrir uma instituição  2. Procurar a ação de editar | Ação ausente ou desabilitada; tentativa direta pela API retorna erro de permissão | Alta | 2 |
| CT05 | RF03 | RLS bloqueia escrita fora do perfil | Token de usuário 'leitura' | 1. Chamar update em instituicao direto pela API com esse token | Operação recusada pelo banco, não apenas pela interface | Alta | 2 |
| CT06 | RF03 | Sessão expirada | Usuário autenticado | 1. Invalidar a sessão  2. Tentar navegar no painel | Redirecionamento para o login sem erro de tela branca | Média | 2 |
| CT07 | RF06 | Cadastrar instituição com dados válidos | Usuário gestor autenticado | 1. Abrir novo cadastro  2. Preencher nome, CNPJ, tipo, cidade, contato  3. Salvar | Instituição criada com status inicial e visível na listagem | Alta | 3 |
| CT08 | RF13 | Impedir CNPJ duplicado | Instituição com CNPJ 11111111111111 já cadastrada | 1. Cadastrar outra instituição com o mesmo CNPJ  2. Salvar | Mensagem clara de CNPJ já cadastrado; registro não é criado | Alta | 3 |
| CT09 | RF06 | CNPJ com formatação | Usuário gestor autenticado | 1. Digitar CNPJ com pontos e barra  2. Salvar | Aceito na digitação, gravado só com dígitos, exibido formatado | Média | 3 |
| CT10 | RF09 | Alterar status para inativa | Instituição ativa | 1. Alterar status para inativa sem informar data de saída | Sistema exige a data de saída antes de concluir | Alta | 3 |
| CT11 | RF10 | Histórico de mudança de status | Instituição ativa | 1. Alterar o status  2. Abrir o histórico da instituição | Registro com situação anterior, nova situação, data e autor | Alta | 3 |
| CT12 | RF11 | Busca ignorando acento | Instituição 'Universidade Alfa' cadastrada | 1. Buscar por 'universidade alfa' sem acento e em minúsculas | Instituição encontrada | Alta | 3 |
| CT13 | RF12 | Filtro por status | Instituições em status variados | 1. Filtrar por 'ativa'  2. Depois por 'em processo' | Listagem mostra apenas o status filtrado; contador confere | Alta | 3 |
| CT14 | RF14 | Cadastrar pessoa | Usuário gestor autenticado | 1. Cadastrar pessoa com nome, e-mail e telefone  2. Salvar | Pessoa criada mesmo sem vínculo com instituição | Alta | 3 |
| CT15 | RF15 | Vincular representante a instituição | Pessoa e instituição cadastradas | 1. Criar vínculo informando cargo e data de início  2. Salvar | Vínculo ativo; pessoa aparece entre os representantes da instituição | Alta | 3 |
| CT16 | RF15 | Impedir dois vínculos ativos iguais | Pessoa já vinculada à instituição X | 1. Criar novo vínculo da mesma pessoa com a instituição X | Operação recusada com mensagem explicativa | Alta | 3 |
| CT17 | RF16 | Encerrar vínculo | Vínculo ativo existente | 1. Encerrar informando a data de fim  2. Confirmar | Vínculo passa a encerrado; continua visível no histórico da instituição | Alta | 3 |
| CT18 | RF17 | Trocar de instituição preservando histórico | Representante com vínculo encerrado na instituição A e presenças registradas | 1. Criar vínculo com a instituição B  2. Abrir o histórico do representante | Duas linhas, uma por instituição, com os percentuais de cada período; a participação em A não migra para B | Alta | 3 |
| CT19 | RF16 | Encerrar vínculo sem data | Vínculo ativo | 1. Encerrar deixando a data de fim em branco | Sistema exige a data antes de concluir | Média | 3 |
| CT20 | RF21 | Cadastrar reunião | Usuário gestor autenticado | 1. Preencher título, data, horário, local e pauta  2. Salvar | Reunião criada com status agendada | Alta | 4 |
| CT21 | RF26 | Gerar QR Code da reunião | Reunião cadastrada | 1. Abrir o detalhe da reunião | QR Code exibido, com opção de baixar ou projetar | Alta | 4 |
| CT22 | RF27 | Acessar check-in pelo QR no celular | Reunião com janela de check-in aberta | 1. Ler o QR com a câmera do celular  2. Aguardar a página | Formulário abre sem exigir login e cabe na tela sem rolagem horizontal | Alta | 4 |
| CT23 | RF28 | Buscar participante pelo nome | Representante cadastrado com vínculo ativo | 1. Digitar parte do nome  2. Ver os resultados | Correspondências listadas em até 1 segundo (RNF07) | Alta | 4 |
| CT24 | RF29 | Identificação automática da instituição | Representante encontrado na busca | 1. Selecionar o próprio nome | Instituição e cargo aparecem preenchidos sem digitação do participante | Alta | 4 |
| CT25 | RF30 | Confirmar presença | Participante identificado | 1. Confirmar | Presença gravada com data e horário; tela de confirmação exibida | Alta | 4 |
| CT26 | RF34 | Check-in duplicado | Participante que já registrou presença | 1. Ler o QR de novo  2. Repetir o processo | Mensagem informando que a presença já constava, com o horário original, apresentada como sucesso e não como erro | Alta | 4 |
| CT27 | RF32 | Participante não encontrado vira convidado | Pessoa não cadastrada na base | 1. Digitar um nome inexistente  2. Seguir como convidado  3. Informar nome, e-mail e instituição | Presença registrada como convidado | Alta | 4 |
| CT28 | RF33 | Convidado não vira representante | Convidado registrado no caso anterior | 1. Abrir a lista de representantes da instituição informada | Convidado não aparece como representante oficial de nenhuma instituição | Alta | 4 |
| CT29 | RNF13 | Check-in fora da janela | Reunião com janela encerrada | 1. Acessar a URL do QR | Mensagem de check-in encerrado; nenhuma presença gravada | Alta | 4 |
| CT30 | RNF12 | URL de check-in não adivinhável | Duas reuniões cadastradas | 1. Trocar o token na URL por outro valor qualquer | Página não encontrada; não é possível chegar a outra reunião por tentativa | Alta | 4 |
| CT31 | RNF09 | Check-in simultâneo | Reunião com janela aberta | 1. Quinze pessoas leem o QR e confirmam ao mesmo tempo | Todas as presenças gravadas, sem erro e sem duplicidade | Alta | 4 |
| CT32 | RF37 | Lista de presença consolidada | Reunião com presenças e convidados | 1. Abrir a lista de presença da reunião | Nome, instituição, cargo, tipo, status e horário de entrada de cada participante | Alta | 4 |
| CT33 | RF38 | Filtros da lista de presença | Lista com presentes, ausentes e convidados | 1. Filtrar por cada opção | Cada filtro devolve apenas os registros correspondentes | Média | 4 |
| CT34 | RF39 | Encerrar reunião marca ausentes | Reunião encerrada com representantes que não compareceram | 1. Encerrar a reunião  2. Abrir a lista | Quem tinha vínculo ativo e não registrou presença aparece como ausente | Alta | 4 |
| CT35 | RF41 | Histórico por representante | Presenças e ausências registradas | 1. Abrir a página do representante | Total de reuniões, presenças, ausências, percentual e última participação conferem com contagem manual | Alta | 5 |
| CT36 | RF42 | Histórico por instituição | Instituição com representantes e presenças | 1. Abrir a página da instituição | Total de representantes, reuniões, presenças e percentual conferem com contagem manual | Alta | 5 |
| CT37 | RF44 | Percentual considera só o período do vínculo | Instituição que entrou depois de reuniões já realizadas | 1. Abrir a participação dessa instituição | Reuniões anteriores à entrada não entram no denominador | Alta | 5 |
| CT38 | RF45 | Indicador reflete correção manual | Presença marcada como ausente por engano | 1. Corrigir para presente  2. Reabrir o painel | Percentual atualizado sem qualquer recálculo manual | Alta | 5 |
| CT39 | RF46 | Painel de indicadores | Base com dados de várias instituições | 1. Abrir o painel | Instituições ativas, inativas, em processo, representantes, reuniões e média de presença conferem | Alta | 5 |
| CT40 | RF47 | Gráfico de evolução | Reuniões em meses diferentes | 1. Abrir o gráfico de evolução | Série temporal coerente com a lista de reuniões encerradas | Média | 5 |
| CT41 | RNF26 | Compatibilidade de navegadores | Sistema em homologação | 1. Repetir o fluxo principal em Chrome, Edge, Firefox e Safari | Comportamento equivalente nos quatro | Média | 6 |
| CT42 | RNF04 | Responsividade do painel | Sistema em homologação | 1. Abrir o painel em desktop e em tablet | Layout utilizável nos dois, sem rolagem horizontal | Média | 6 |
| CT43 | RNF17 | Exposição de dados pessoais | Usuário não autenticado | 1. Tentar acessar rotas do painel e endpoints de dados | Nenhum dado pessoal retornado sem autenticação | Alta | 6 |
| CT44 | RNF14 | Limite de tentativas no check-in | Reunião com janela aberta | 1. Disparar muitas requisições seguidas ao endpoint de check-in | Requisições passam a ser recusadas após o limite | Média | 6 |
| CT45 | RNF19 | Histórico não muda retroativamente | Representante com presenças antigas por outra instituição | 1. Alterar o vínculo atual  2. Reabrir as reuniões antigas | Presenças antigas continuam apontando para a instituição da época | Alta | 6 |

## Cobertura por semana

| Semana | Casos | Foco |
|---|---|---|
| 2 | CT01 a CT06 | Autenticação e perfis |
| 3 | CT07 a CT19 | Cadastros, vínculos e preservação de histórico |
| 4 | CT20 a CT34 | Reuniões, QR Code, check-in e lista de presença |
| 5 | CT35 a CT40 | Histórico e indicadores |
| 6 | CT41 a CT45 | Compatibilidade, segurança e regressão |

## Casos que merecem atenção especial

**CT18 e CT45** verificam a decisão central da modelagem: histórico que não se
reescreve quando alguém troca de instituição. Falha aqui é sempre bloqueante.

**CT26** parece detalhe e não é. Numa reunião, quem não tem certeza se o
check-in funcionou vai ler o QR de novo. Se a segunda tentativa mostrar erro
vermelho, a pessoa procura alguém da organização e a fila para. A mensagem
precisa comunicar sucesso.

**CT31** só tem valor com celulares e rede de verdade. Simular com script no
mesmo Wi-Fi não reproduz o cenário — teste também em 4G.
