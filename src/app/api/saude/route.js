/**
 * APRESENTAÇÃO — verificação de saúde da aplicação.
 *
 *   GET /api/saude
 *
 * Para o monitoramento da plataforma e para o QA saber, num clique, se o
 * ambiente está de pé e com o banco na versão certa.
 *
 * É a única rota do painel que responde sem sessão (e está na lista de rotas
 * públicas do middleware): um verificador de saúde não faz login. Em troca, não
 * devolve dado nenhum do ecossistema.
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
