/**
 * The durable control plane on plain Postgres, without Supabase.
 *
 * RemoteBackend (see store.js) speaks to exactly six functions, by name, with
 * named arguments — which is all PostgREST was ever giving it. So the entire
 * Supabase dependency for control storage is this file: a { rpc } object of the
 * same shape, talking to Postgres directly.
 *
 * Apply the schema first with `node server/migrations/run.mjs`.
 */

let pool = null;

/** pg is only needed on this path, so it loads on demand, like the cloud SDK. */
async function getPool(connectionString) {
  if (pool) return pool;
  let pg;
  try {
    ({ default: pg } = await import('pg'));
  } catch {
    throw Object.assign(new Error('DATABASE_URL is set but the "pg" package is not installed'),
      { code: 'storage_unavailable', status: 503 });
  }
  pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    // The control store is on the request path; a hung connect must not hang a request.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  // A pool that emits an unhandled 'error' takes the process down with it.
  pool.on('error', (err) => console.error('[pg] idle client error:', err.message));
  return pool;
}

/**
 * jsonb arguments must be sent as JSON text. This matters most for arrays:
 * node-postgres renders a JS array as a Postgres array literal ({a,b}), not as
 * JSON, so `writes` and `events` would arrive malformed without this.
 */
const toParam = (value) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : value);

/**
 * @param {string} [connectionString]
 * @returns {{ rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data?: unknown, error?: { message: string } }> }|null}
 */
export function pgRemote(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) return null;
  return {
    async rpc(name, args = {}) {
      const keys = Object.keys(args);
      // Named notation, so argument order here never has to track the SQL.
      const call = `select oya_browser.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      try {
        const db = await getPool(connectionString);
        const result = await db.query(call, keys.map((k) => toParam(args[k])));
        // One function, one column, named after the function.
        const row = result.rows[0];
        return { data: row ? row[name] ?? null : null };
      } catch (error) {
        // RemoteBackend.call() reads these messages to tell a conflict from an
        // outage, so pass the text through rather than wrapping it.
        return { error: { message: String(error.message || error) } };
      }
    },
  };
}

export async function closePgPool() {
  await pool?.end();
  pool = null;
}
