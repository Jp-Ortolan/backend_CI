import { NextRequest } from 'next/server';
import { z } from 'zod';
import { consultaUm } from '@/lib/db/consulta';
import { ErroDeNegocio } from '@/lib/dominio/erros';
import { ok, falha } from '@/lib/dominio/resposta';
import { traduzirErroDoBanco } from '@/lib/dominio/erros-banco';

export const dynamic = 'force-dynamic';

type Contexto = { params: { token: string } };

/**
 * As três rotas de check-in delegam a regra às funções do banco
 * (checkin_reuniao, checkin_buscar, checkin_registrar). A aplicação traduz
 * entrada e saída; quem decide o que pode é o banco — assim a regra vale para
 * qualquer código que chegue nele.
 */

interface ReuniaoPublica {
  titulo: string; data: string; hora_inicio: string | null;
  local: string | null; status: string; aberto: boolean;
}

/** GET — dados públicos da reunião para montar a tela (RF27). */
export async function GET(_req: NextRequest, { params }: Contexto) {
  try {
    const r = await consultaUm<ReuniaoPublica>(
      'select * from checkin_reuniao($1)', [params.token],
    );
    if (!r) {
      throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA',
        'Não encontramos esta reunião. Confira o QR Code.');
    }
    return ok({
      reuniao: { titulo: r.titulo, data: r.data, horaInicio: r.hora_inicio, local: r.local },
      checkinAberto: r.aberto,
    });
  } catch (e) {
    return falha(e);
  }
}

const corpo = z.union([
  z.object({ pessoaId: z.string().uuid() }),
  z.object({
    convidado: z.object({
      nome: z.string().trim().min(3, 'Informe seu nome completo.'),
      email: z.string().trim().email().optional().or(z.literal('')),
      instituicao: z.string().trim().optional().or(z.literal('')),
    }),
  }),
]);

interface Registro {
  out_presenca_id: string;
  out_participante: string;
  out_instituicao: string | null;
  out_cargo: string | null;
  out_tipo: 'representante' | 'convidado';
  out_registrado_em: string;
  out_ja_existia: boolean;
}

/** POST — registra a presença (RF29 a RF34). */
export async function POST(req: NextRequest, { params }: Contexto) {
  try {
    const analise = corpo.safeParse(await req.json().catch(() => null));
    if (!analise.success) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        analise.error.issues[0]?.message ?? 'Dados inválidos.');
    }

    const d = analise.data;
    const args = 'convidado' in d
      ? [params.token, null, d.convidado.nome,
         d.convidado.email || null, d.convidado.instituicao || null]
      : [params.token, d.pessoaId, null, null, null];

    let linha: Registro | null;
    try {
      linha = await consultaUm<Registro>(
        'select * from checkin_registrar($1, $2, $3, $4, $5)', args,
      );
    } catch (e) { traduzirErroDoBanco(e); }

    if (!linha) throw new ErroDeNegocio('ERRO_INTERNO', 'Não foi possível registrar a presença.');

    const resposta = {
      presencaId: linha.out_presenca_id,
      nome: linha.out_participante,
      instituicao: linha.out_instituicao,
      cargo: linha.out_cargo,
      tipo: linha.out_tipo,
      horarioCheckin: linha.out_registrado_em,
    };

    // Já tinha registrado: para o participante isso é sucesso, não erro (RF34).
    // Ele fez a coisa certa duas vezes; a tela precisa dizer que está tudo bem.
    if (linha.out_ja_existia) {
      throw new ErroDeNegocio('PRESENCA_JA_REGISTRADA',
        'Sua presença já estava registrada.', resposta);
    }

    return ok(resposta, 201);
  } catch (e) {
    return falha(e);
  }
}
