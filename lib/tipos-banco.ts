/**
 * Tipos do banco.
 *
 * Esta é uma versão escrita à mão, cobrindo o que o back-end usa hoje.
 * Assim que o Supabase local estiver de pé, substitua rodando:
 *
 *     npm run db:tipos
 *
 * (equivale a: supabase gen types typescript --local > lib/tipos-banco.ts)
 */

export type StatusInstituicao =
  | 'em_processo_entrada' | 'ativa' | 'em_processo_saida' | 'inativa';
export type StatusVinculo    = 'ativo' | 'encerrado';
export type StatusReuniao    = 'agendada' | 'em_andamento' | 'encerrada' | 'cancelada';
export type TipoParticipante = 'representante' | 'convidado';
export type StatusPresenca   = 'presente' | 'ausente' | 'justificado';
export type OrigemPresenca   = 'qrcode' | 'manual' | 'importacao';
export type PapelUsuario     = 'admin' | 'gestor' | 'leitura';

export interface Instituicao {
  id: string;
  nome: string;
  cnpj: string | null;
  tipo_instituicao_id: number | null;
  cidade: string | null;
  uf: string | null;
  email: string | null;
  telefone: string | null;
  site: string | null;
  responsavel: string | null;
  status: StatusInstituicao;
  data_entrada: string | null;
  data_saida: string | null;
  observacoes: string | null;
}

export interface Pessoa {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
}

export interface Vinculo {
  id: string;
  pessoa_id: string;
  instituicao_id: string;
  cargo: string | null;
  status: StatusVinculo;
  data_inicio: string;
  data_fim: string | null;
}

export interface Reuniao {
  id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  descricao: string | null;
  pauta: string | null;
  status: StatusReuniao;
  qr_token: string;
  checkin_abre_em: string | null;
  checkin_fecha_em: string | null;
}

export interface Presenca {
  id: string;
  reuniao_id: string;
  pessoa_id: string | null;
  vinculo_id: string | null;
  instituicao_id: string | null;
  cargo_no_momento: string | null;
  tipo: TipoParticipante;
  status: StatusPresenca;
  origem: OrigemPresenca;
  horario_checkin: string | null;
  nome_informado: string | null;
  email_informado: string | null;
  instituicao_informada: string | null;
}
