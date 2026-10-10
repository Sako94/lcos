import "server-only";
import postgres from "postgres";

/**
 * Database access with row-level security enforced per request.
 *
 * Every user-facing query runs inside a transaction that:
 *   1. switches to the `authenticated` role (RLS applies),
 *   2. sets request.jwt.claim.sub to the signed-in user's id (what auth.uid() reads),
 *   3. sets app.actor = 'user'.
 *
 * Agent jobs use withAgent(): the service role (bypasses RLS) but app.actor = 'agent', so the
 * database triggers still stop the agent from approving, publishing, or changing status past review.
 * Agent code must always scope its queries by client_id; that is checked in tests.
 */

declare global {
  var __lcos_sql: ReturnType<typeof postgres> | undefined;
}

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    max: 5,
    prepare: false,
    transform: postgres.camel,
    // date columns come back as 'YYYY-MM-DD' strings (not Date objects) so they round-trip through forms
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
  });
}

export const sql = globalThis.__lcos_sql ?? connect();
if (process.env.NODE_ENV !== "production") globalThis.__lcos_sql = sql;

export type Tx = postgres.TransactionSql<Record<string, unknown>>;

export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`select set_config('app.actor', 'user', true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

export async function withAgent<T>(clientId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role service_role`);
    await tx`select set_config('request.jwt.claim.sub', '', true)`;
    await tx`select set_config('app.actor', 'agent', true)`;
    await tx`select set_config('app.client_scope', ${clientId}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

/**
 * A client using a private onboarding link (no login). Reads are scoped by the token in the calling code;
 * every write goes through the app.onboarding_* database functions, which check the token, status and expiry.
 */
export async function withClientLink<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role service_role`);
    await tx`select set_config('request.jwt.claim.sub', '', true)`;
    await tx`select set_config('app.actor', 'client', true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

/** Service-role access for system work that is not on behalf of a user (job scheduling, integration status). */
export async function withService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role service_role`);
    await tx`select set_config('app.actor', 'system', true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}
