import pg from 'pg';

const { Pool } = pg;

/**
 * Coluna `date` volta como TEXTO, não como Date do JavaScript.
 *
 * Por padrão o driver converte `date` (OID 1082) para Date, interpretando o
 * valor no fuso do servidor. Duas consequências ruins:
 *
 * 1. `JSON.stringify` transforma Date em timestamp UTC completo. A data de uma
 *    reunião ("2026-09-12") sai da API como "2026-09-12T03:00:00.000Z", e num
 *    servidor com fuso à frente de UTC vira o DIA ANTERIOR. O contrato diz que
 *    data é ISO 8601 — e para `date`, ISO 8601 é AAAA-MM-DD.
 *
 * 2. Comparação com string para de funcionar em silêncio. `'2026-08-31' <
 *    dataDoBanco` compara texto com número (o Date vira timestamp) e devolve
 *    sempre false: a checagem existe, roda e nunca acusa nada.
 *
 * Devolver o texto que o PostgreSQL já mandou resolve os dois. `timestamptz`
 * continua virando Date, que é o certo — ali o instante no tempo é o dado.
 */
pg.types.setTypeParser(1082, (valor) => valor);

/**
 * Pool de conexões com o PostgreSQL.
 *
 * Em desenvolvimento o Next recarrega os módulos a cada alteração; sem guardar o
 * pool no globalThis, cada recarga abriria um pool novo e as conexões antigas
 * ficariam penduradas até estourar o limite do banco.
 *
 * @type {{ poolPg?: import('pg').Pool }}
 */
const global_ = globalThis;

/**
 * O Railway exige TLS e apresenta certificado próprio; Postgres local
 * normalmente nem tem TLS ligado. A regra: só não usa TLS quando é claramente
 * local — endereço de loopback, soquete unix, ou sslmode=disable explícito.
 *
 * @param {string} url
 */
function configSsl(url) {
  const local = /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(url);
  return local ? undefined : { rejectUnauthorized: false };
}

/** @returns {import('pg').Pool} */
export function pool() {
  if (!global_.poolPg) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não está definida.');

    global_.poolPg = new Pool({
      connectionString: url,
      max: Number(process.env.DB_MAX_CONEXOES ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: configSsl(url),
    });

    global_.poolPg.on('error', (e) => {
      console.error('[pg] erro em conexão ociosa', e);
    });
  }
  return global_.poolPg;
}

/**
 * Encerra o pool e devolve as conexões.
 *
 * A aplicação web nunca chama isto: o pool tem que viver enquanto o processo
 * viver. Quem precisa é teste e script — sem encerrar, o processo fica de pé
 * até o idleTimeoutMillis expirar (30 segundos por conexão ociosa), e uma
 * suíte de quatro arquivos passa a levar dois minutos só esperando.
 *
 * @returns {Promise<void>}
 */
export async function fecharPool() {
  if (!global_.poolPg) return;
  const p = global_.poolPg;
  global_.poolPg = undefined;
  await p.end();
}
