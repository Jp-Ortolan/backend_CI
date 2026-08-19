import { NextResponse } from 'next/server';
import { ErroDeNegocio, statusDoCodigo } from './erros';

/** Resposta de sucesso. */
export function ok<T>(dados: T, status = 200) {
  return NextResponse.json(dados, { status });
}

/**
 * Converte qualquer exceção no formato de erro do contrato.
 *
 * Erro inesperado nunca vaza mensagem do banco para o cliente: vai para o log
 * do servidor e o cliente recebe ERRO_INTERNO.
 */
export function falha(e: unknown) {
  if (e instanceof ErroDeNegocio) {
    return NextResponse.json(
      { erro: { codigo: e.codigo, mensagem: e.message, ...(e.extra ?? {}) } },
      { status: e.status },
    );
  }

  console.error('[erro inesperado]', e);
  return NextResponse.json(
    { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor.' } },
    { status: statusDoCodigo('ERRO_INTERNO') },
  );
}
