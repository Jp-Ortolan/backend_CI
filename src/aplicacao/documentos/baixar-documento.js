/**
 * CASO DE USO — Baixar o conteúdo de um documento.
 *
 * Devolve os bytes e o que a rota precisa para montar os cabeçalhos. Quem
 * define os cabeçalhos de segurança é a rota; aqui fica a decisão de QUE
 * documento pode sair.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ler } from '@/infraestrutura/armazenamento/index.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';
import { sanitizarNome } from '@/dominio/arquivos.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @returns {Promise<{ nome: string, mimeType: string, conteudo: Buffer }>}
 */
export async function baixarDocumento(usuario, id) {
  const u = exigir(usuario, 'documento', 'ver');

  return comUsuario(u.id, async (tx) => {
    const d = await tx.consultaUm(
      `select id, nome, storage_path, url_externa, mime_type, tamanho_bytes
         from documento where id = $1`,
      [id],
    );
    if (!d) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Documento não encontrado.');

    if (d.url_externa) {
      throw new ErroDeNegocio('DOCUMENTO_E_LINK',
        'Este documento é um link externo e não fica guardado no sistema.',
        { urlExterna: d.url_externa });
    }

    const conteudo = await ler(tx, { documentoId: d.id, caminho: d.storage_path });

    // Metadado sem conteúdo não deveria existir — as duas gravações são feitas
    // na mesma transação. Se acontecer, é defeito, e responder 404 esconderia
    // um banco inconsistente em vez de expor.
    if (!conteudo) {
      throw new ErroDeNegocio('ERRO_INTERNO',
        'O conteúdo deste documento não foi encontrado no armazenamento.');
    }

    return {
      nome: sanitizarNome(d.nome),
      // Tipo genérico quando não se sabe: melhor o navegador tratar como
      // binário desconhecido do que adivinhar e renderizar.
      mimeType: d.mime_type ?? 'application/octet-stream',
      conteudo: Buffer.from(conteudo),
    };
  });
}
