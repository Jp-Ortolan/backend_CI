/**
 * Contrato que todo adaptador de armazenamento precisa cumprir.
 * Arquivo sem código: existe para documentar a porta.
 *
 *   salvar(tx, { documentoId, caminho, conteudo }) -> Promise<void>
 *   ler(tx, { documentoId, caminho })              -> Promise<Buffer|null>
 *   remover(tx, { documentoId, caminho })          -> Promise<void>
 *
 * Dois identificadores porque o Postgres endereça por documentoId e o S3 por
 * caminho. `tx` vem primeiro para o adaptador entrar na mesma transação do
 * metadado: metadado sem conteúdo vira botão Baixar quebrado.
 */

export {};
