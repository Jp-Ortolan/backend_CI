/**
 * A porta do armazenamento — o contrato que qualquer adaptador precisa cumprir.
 *
 * Este arquivo não tem código executável de propósito: ele existe para que a
 * troca de armazenamento seja uma decisão de uma linha em `index.js`, e para
 * que quem escrever o adaptador de S3/R2 saiba exatamente o que implementar.
 *
 * O CONTRATO
 *
 *   salvar(tx, { documentoId, caminho, conteudo })  -> Promise<void>
 *   ler(tx, { documentoId, caminho })               -> Promise<Buffer|null>
 *   remover(tx, { documentoId, caminho })           -> Promise<void>
 *
 * POR QUE OS DOIS IDENTIFICADORES
 * O adaptador do Postgres endereça o blob por `documentoId`, que é a chave
 * primária de documento_conteudo. Um adaptador de S3 endereça por `caminho`,
 * que é a chave do objeto no bucket. Passar os dois evita que o adaptador
 * precise ir ao banco procurar o que já se sabe — e `caminho` fica gravado em
 * documento.storage_path desde o primeiro dia, mesmo enquanto ninguém o usa,
 * para que a migração futura tenha o endereço de destino pronto.
 *
 * POR QUE `tx` É O PRIMEIRO PARÂMETRO
 * O envio grava duas coisas: a linha de metadado e os bytes. As duas têm que
 * cair ou passar juntas — metadado sem conteúdo vira um botão "Baixar" que dá
 * erro, e conteúdo sem metadado é lixo que ninguém encontra para apagar.
 * Recebendo a transação, o adaptador participa dessa garantia.
 *
 * Um adaptador de S3 não consegue participar da transação do banco (a rede não
 * desfaz). O padrão para ele: subir o objeto ANTES do commit e, se o commit
 * falhar, apagar o objeto no catch. Sobra a hipótese de o processo morrer no
 * meio, que deixa objeto órfão no bucket — resolvido com uma rotina de
 * limpeza que apaga objeto sem linha correspondente. Ignorar isso é como
 * costuma nascer um bucket que só cresce.
 */

export {};
