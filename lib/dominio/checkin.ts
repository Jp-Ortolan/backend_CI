import { ErroDeNegocio } from './erros';
import type { Reuniao, Vinculo } from '../tipos-banco';

/** Colunas públicas da reunião. Não expõe qr_token nem lista de participantes. */
export type ReuniaoPublica = Pick<
  Reuniao, 'id' | 'titulo' | 'data' | 'hora_inicio' | 'local' | 'status'
> & { checkin_abre_em: string | null; checkin_fecha_em: string | null };

/**
 * O check-in está aberto? (RNF13)
 *
 * Sem janela definida, vale o dia da reunião — assim uma reunião cadastrada às
 * pressas não fica com o check-in travado.
 */
export function checkinAberto(r: ReuniaoPublica, agora = new Date()): boolean {
  if (r.status === 'cancelada' || r.status === 'encerrada') return false;

  if (r.checkin_abre_em && agora < new Date(r.checkin_abre_em)) return false;
  if (r.checkin_fecha_em && agora > new Date(r.checkin_fecha_em)) return false;

  if (!r.checkin_abre_em && !r.checkin_fecha_em) {
    return r.data === agora.toISOString().slice(0, 10);
  }
  return true;
}

export function exigirCheckinAberto(r: ReuniaoPublica, agora = new Date()): void {
  if (r.status === 'cancelada') {
    throw new ErroDeNegocio('REUNIAO_CANCELADA', 'Esta reunião foi cancelada.');
  }
  if (!checkinAberto(r, agora)) {
    throw new ErroDeNegocio(
      'CHECKIN_FECHADO',
      'O registro de presença desta reunião não está aberto neste momento.',
    );
  }
}

/**
 * Escolhe o vínculo válido NA DATA DA REUNIÃO (RF31).
 *
 * É isto que faz o histórico não ser reescrito: a presença fica amarrada à
 * instituição que a pessoa representava na época, não à atual.
 */
export function vinculoNaData(vinculos: Vinculo[], dataReuniao: string): Vinculo | null {
  const validos = vinculos.filter(
    (v) => v.data_inicio <= dataReuniao && (v.data_fim === null || v.data_fim >= dataReuniao),
  );
  if (validos.length === 0) return null;

  // Mais de um vínculo válido: fica com o ativo; se todos encerrados, o mais recente.
  const ativo = validos.find((v) => v.status === 'ativo');
  if (ativo) return ativo;

  return validos.reduce((a, b) => (a.data_inicio >= b.data_inicio ? a : b));
}

/** Nome digitado no check-in: mínimo de 3 caracteres (RNF14). */
export function normalizarBusca(termo: string): string {
  const limpo = termo.trim().replace(/\s+/g, ' ');
  if (limpo.length < 3) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Digite ao menos 3 letras do nome.');
  }
  return limpo;
}

export const LIMITE_RESULTADOS_BUSCA = 5;
