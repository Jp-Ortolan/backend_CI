import { NextRequest } from 'next/server';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ErroDeNegocio } from '@/lib/dominio/erros';
import { ok, falha } from '@/lib/dominio/resposta';
import { checkinAberto, exigirCheckinAberto, vinculoNaData } from '@/lib/dominio/checkin';
import type { ReuniaoPublica } from '@/lib/dominio/checkin';
import type { Vinculo } from '@/lib/tipos-banco';

export const dynamic = 'force-dynamic';

type Contexto = { params: { token: string } };

const COLUNAS_PUBLICAS =
  'id, titulo, data, hora_inicio, local, status, checkin_abre_em, checkin_fecha_em';

async function buscarReuniao(token: string): Promise<ReuniaoPublica> {
  const supabase = criarClienteAdmin();
  const { data, error } = await supabase
    .from('reuniao')
    .select(COLUNAS_PUBLICAS)
    .eq('qr_token', token)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new ErroDeNegocio(
      'REUNIAO_NAO_ENCONTRADA',
      'Não encontramos esta reunião. Confira o QR Code.',
    );
  }
  return data as unknown as ReuniaoPublica;
}

/** GET — dados públicos da reunião para montar a tela (RF27). */
export async function GET(_req: NextRequest, { params }: Contexto) {
  try {
    const r = await buscarReuniao(params.token);
    return ok({
      reuniao: {
        titulo: r.titulo,
        data: r.data,
        horaInicio: r.hora_inicio,
        local: r.local,
      },
      checkinAberto: checkinAberto(r),
    });
  } catch (e) {
    return falha(e);
  }
}

const corpo = z.union([
  z.object({ pessoaId: z.string().uuid(), vinculoId: z.string().uuid().optional() }),
  z.object({
    convidado: z.object({
      nome: z.string().trim().min(3, 'Informe seu nome completo.'),
      email: z.string().trim().email().optional().or(z.literal('')),
      instituicao: z.string().trim().optional().or(z.literal('')),
    }),
  }),
]);

/** POST — registra a presença (RF29 a RF34). */
export async function POST(req: NextRequest, { params }: Contexto) {
  try {
    const reuniao = await buscarReuniao(params.token);
    exigirCheckinAberto(reuniao);

    const analise = corpo.safeParse(await req.json().catch(() => null));
    if (!analise.success) {
      throw new ErroDeNegocio(
        'DADOS_INVALIDOS',
        analise.error.issues[0]?.message ?? 'Dados inválidos.',
      );
    }

    const supabase = criarClienteAdmin();
    const dados = analise.data;

    // ------------------------------------------------------------ convidado
    if ('convidado' in dados) {
      const { nome, email, instituicao } = dados.convidado;
      const { data, error } = await supabase
        .from('presenca')
        .insert({
          reuniao_id: reuniao.id,
          tipo: 'convidado',            // sem vinculo_id — o banco recusaria (RF33)
          status: 'presente',
          origem: 'qrcode',
          horario_checkin: new Date().toISOString(),
          nome_informado: nome,
          email_informado: email || null,
          instituicao_informada: instituicao || null,
        })
        .select('id, horario_checkin')
        .single();

      if (error) throw error;
      return ok(
        {
          presencaId: data.id,
          nome,
          instituicao: instituicao || null,
          tipo: 'convidado',
          horarioCheckin: data.horario_checkin,
        },
        201,
      );
    }

    // ------------------------------------------------------- representante
    const { pessoaId } = dados;

    const { data: pessoa, error: erroPessoa } = await supabase
      .from('pessoa').select('id, nome').eq('id', pessoaId).maybeSingle();
    if (erroPessoa) throw erroPessoa;
    if (!pessoa) {
      throw new ErroDeNegocio('VINCULO_INVALIDO', 'Participante não encontrado.');
    }

    const { data: vinculos, error: erroVinculos } = await supabase
      .from('vinculo')
      .select('id, pessoa_id, instituicao_id, cargo, status, data_inicio, data_fim')
      .eq('pessoa_id', pessoaId);
    if (erroVinculos) throw erroVinculos;

    // Vínculo válido NA DATA DA REUNIÃO, não o atual — é o snapshot (RF31).
    const vinculo = vinculoNaData((vinculos ?? []) as Vinculo[], reuniao.data);
    if (!vinculo) {
      throw new ErroDeNegocio(
        'VINCULO_INVALIDO',
        'Não encontramos um vínculo institucional válido para você nesta data.',
      );
    }

    const { data: instituicao } = await supabase
      .from('instituicao').select('nome').eq('id', vinculo.instituicao_id).maybeSingle();

    const { data, error } = await supabase
      .from('presenca')
      .insert({
        reuniao_id: reuniao.id,
        pessoa_id: pessoaId,
        vinculo_id: vinculo.id,
        instituicao_id: vinculo.instituicao_id,
        cargo_no_momento: vinculo.cargo,
        tipo: 'representante',
        status: 'presente',
        origem: 'qrcode',
        horario_checkin: new Date().toISOString(),
      })
      .select('id, horario_checkin')
      .single();

    if (error) {
      // 23505 = unique_violation -> já registrou (RF34).
      // Para o participante isto NÃO é erro: ele fez a coisa certa duas vezes.
      if (error.code === '23505') {
        const { data: anterior } = await supabase
          .from('presenca')
          .select('id, horario_checkin')
          .eq('reuniao_id', reuniao.id)
          .eq('pessoa_id', pessoaId)
          .single();

        throw new ErroDeNegocio(
          'PRESENCA_JA_REGISTRADA',
          'Sua presença já estava registrada.',
          { presencaId: anterior?.id, horarioCheckin: anterior?.horario_checkin },
        );
      }
      throw error;
    }

    return ok(
      {
        presencaId: data.id,
        nome: pessoa.nome,
        instituicao: instituicao?.nome ?? null,
        cargo: vinculo.cargo,
        tipo: 'representante',
        horarioCheckin: data.horario_checkin,
      },
      201,
    );
  } catch (e) {
    return falha(e);
  }
}
