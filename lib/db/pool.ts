import { Pool } from 'pg';

/**
 * Pool de conexões com o PostgreSQL.
 *
 * Em desenvolvimento o Next recarrega os módulos a cada alteração; sem guardar o
 * pool no globalThis, cada recarga abriria um pool novo e as conexões antigas
 * ficariam penduradas até estourar o limite do banco.
 */
const global_ = globalThis as unknown as { poolPg?: Pool };

/**
 * O Railway exige TLS e apresenta certificado próprio; Postgres local
 * normalmente nem tem TLS ligado. A regra: só não usa TLS quando é claramente
 * local — endereço de loopback, soquete unix, ou sslmode=disable explícito.
 */
function configSsl(url: string) {
  const local = /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(url);
  return local ? undefined : { rejectUnauthorized: false };
}

export function pool(): Pool {
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
