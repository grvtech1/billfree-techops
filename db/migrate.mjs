// Transactional, tracked SQL migration runner. Idempotent: each file in
// migrations/ is applied once (recorded in schema_migrations) inside its own
// transaction. Runs locally (docker-compose), as a K8s pre-sync Job, and in CI.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const already = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (already.rowCount) {
      console.log(`• skip   ${file}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ apply  ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('migrations complete');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
