/**
 * APRESENTAÇÃO — verificação de saúde da aplicação.
 *
 *   GET /api/saude
 *
 * Para o monitoramento da plataforma e para o QA saber, em um clique, se o
 * ambiente está de pé e com o banco na versão certa.
 *
 * É a única rota do painel que responde SEM sessão, de propósito: um
 * verificador de saúde não tem como fazer login, e responder 401 para ele faria
 * o monitor acusar queda com o sistema no ar. Em compensação ela não devolve
 * nenhum dado do ecossistema — só se conecta, quantas migrations rodaram e há
 * quanto tempo o processo está de pé.
 *
 * Está na lista de rotas públicas do middleware pelo mesmo motivo.
 */
import { consulta, consultaUm } from '@/infraestrutura/banco/consulta.js';
import { log } from '@/infraestrutura/observabilidade/log.js';

export const dynamic = 'force-dynamic';

const SUBIU_EM = Date.now();

export async function GET() {
  const comecou = Date.now();

  try {
    // Consulta trivial: prova que o pool conecta e que o banco responde.
    await consulta('select 1');

    const m = await consultaUm(
      `select count(*)::int as total, max(arquivo) as ultima
         from migration_aplicada`,
    );

    return Response.json({
      status: 'ok',
      banco: { conectado: true, latenciaMs: Date.now() - comecou },
      migrations: { aplicadas: m?.total ?? 0, ultima: m?.ultima ?? null },
      aplicacao: {
        ambiente: process.env.NODE_ENV ?? 'desconhecido',
        armazenamento: process.env.ARMAZENAMENTO ?? 'postgres',
        noArDesdeSegundos: Math.round((Date.now() - SUBIU_EM) / 1000),
      },
    }, {
      // Sem cache: uma resposta guardada diria "está de pé" depois de cair.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    log.erro('saude_falhou', e);

    // 503 e não 500: é o código que os monitores entendem como "fora do ar
    // temporariamente" e que faz o balanceador parar de mandar tráfego.
    return Response.json(
      { status: 'indisponivel', banco: { conectado: false } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
