// Apply supabase/migrations/*.sql to a remote Postgres (Supabase). Usage: DATABASE_URL=... node scripts/migrate-remote.mjs
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1, prepare: false });

await sql`create table if not exists public._lcos_migrations (name text primary key, applied_at timestamptz not null default now())`;
const applied = new Set((await sql`select name from public._lcos_migrations`).map((r) => r.name));
const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  if (applied.has(f)) { console.log("skip", f); continue; }
  const text = readFileSync(`supabase/migrations/${f}`, "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(text);
    await tx`insert into public._lcos_migrations (name) values (${f})`;
  });
  console.log("applied", f);
}
await sql.unsafe(`
  grant usage on schema app to authenticated, service_role;
  grant execute on all functions in schema app to authenticated, service_role;
  grant all on all tables in schema public to authenticated, service_role;
  grant usage, select on all sequences in schema public to authenticated, service_role;
  revoke all on public.integration_secrets from authenticated;
`);
await sql.end();
console.log("migrations done");
