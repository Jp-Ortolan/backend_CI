import { NextRequest } from 'next/server';
import { consulta } from '@/lib/db/consulta';
import { ErroDeNegocio } from '@/lib/dominio/erros';
import { ok, falha } from '@/lib/dominio/resposta';
import { traduzirErroDoBanco } from '@/lib/dominio/erros-banco';

export const dynamic = 'force-dynamic';

interface Candidato {
  pessoa_id: string; nome: string; instituicao: string;
  cargo: string | null; vinculo_id: string;
}

/**
 * GET — busca o participante pelo nome (RF28).
 *
 * A função do banco devolve no máximo 5 resultados e exige 3 caracteres:
 * retornar nome e instituição de quem ainda não confirmou presença é uma
 * exposição pequena mas real, e os dois limites dificultam varrer a base.
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const termo = (req.nextUrl.searchParams.get('nome') ?? '').trim();
    if (termo.length < 3) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', 'Digite ao menos 3 letras do nome.');
    }

    let linhas: Candidato[] = [];
    try {
      linhas = await consulta<Candidato>(
        'select * from checkin_buscar($1, $2)', [params.token, termo],
      );
    } catch (e) { traduzirErroDoBanco(e); }

    return ok({
      resultados: linhas.map(l => ({
        pessoaId: l.pessoa_id,
        nome: l.nome,
        instituicao: l.instituicao,
        cargo: l.cargo,
        vinculoId: l.vinculo_id,
      })),
    });
  } catch (e) {
    return falha(e);
  }
}
