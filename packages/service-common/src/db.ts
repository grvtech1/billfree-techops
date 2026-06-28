import pg from 'pg';

/**
 * Shared Postgres connection-pool factory. One pool per service process; the
 * pool manages connection reuse, so handlers just `pool.query(...)`. The pool is
 * also what the readiness probe checks (a `SELECT 1`).
 */
export type Pool = pg.Pool;

/**
 * Anything that can run a query — a Pool or a transaction-bound PoolClient.
 * Repositories type their executor as this so the SAME method works both
 * standalone (pool) and inside a transaction (client).
 */
export type Queryable = Pick<pg.Pool, 'query'>;

/**
 * Run `fn` inside a single transaction on a dedicated client. Commits on
 * success, rolls back on any throw, and always releases the client. Use this to
 * make multi-statement writes atomic (e.g. a ticket insert + its audit record).
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* connection may be dead; release below regardless */
    });
    throw err;
  } finally {
    client.release();
  }
}

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
