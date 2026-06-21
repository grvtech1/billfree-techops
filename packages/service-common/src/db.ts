import pg from 'pg';

/**
 * Shared Postgres connection-pool factory. One pool per service process; the
 * pool manages connection reuse, so handlers just `pool.query(...)`. The pool is
 * also what the readiness probe checks (a `SELECT 1`).
 */
export type Pool = pg.Pool;

export function createPool(opts: { connectionString: string; max?: number }): Pool {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Managed Postgres (RDS) terminates idle TLS; keepAlive avoids stale sockets.
    keepAlive: true,
  });
  return pool;
}

/** Readiness check — true if the DB answers a trivial query within the timeout. */
export async function pingDb(pool: Pool): Promise<boolean> {
  try {
    const res = await pool.query('SELECT 1 AS ok');
    return res.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
