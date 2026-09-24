import { NextResponse } from 'next/server';
import { ErroDeNegocio, statusDoCodigo } from '@/dominio/erros.js';
import { log } from '@/infraestrutura/observabilidade/log.js';

/**
 * Resposta de sucesso.
 *
 * @param {unknown} dados
 * @param {number} [status]
 */
export function ok(dados, status = 200) {
  return NextResponse.json(dados, { status });
}

/**
 * Converte qualquer exceção no formato de erro do contrato.
 *
 * Erro inesperado nunca vaza mensagem do banco para o cliente: vai para o log
 * do servidor e o cliente recebe ERRO_INTERNO.
 *
 * @param {unknown} e
 */
export function falha(e) {
  if (e instanceof ErroDeNegocio) {
// Erro de negócio é fluxo normal; fica em aviso para o nível erro continuar
// significando alguém precisa olhar isso.
    log.aviso('erro_de_negocio', { codigo: e.codigo, status: e.status });

    return NextResponse.json(
      { erro: { codigo: e.codigo, mensagem: e.message, ...(e.extra ?? {}) } },
      { status: e.status },
    );
  }

  log.erro('erro_inesperado', e);

  return NextResponse.json(
    { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor.' } },
    { status: statusDoCodigo('ERRO_INTERNO') },
  );
}
