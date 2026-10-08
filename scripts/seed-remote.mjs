// Seed a Supabase (or any) Postgres from the SQL seed files, mapping the fixed local user ids to the real
// auth.users ids by email. Usage: DATABASE_URL=... node scripts/seed-remote.mjs
import postgres from "postgres";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1, prepare: false });

const fixed = {
  "00000000-0000-4000-8000-000000000001": "sako@wavystudios.com",
  "00000000-0000-4000-8000-000000000002": "drew@wavystudios.com",
  "00000000-0000-4000-8000-000000000003": "andre@wavystudios.com",
  "00000000-0000-4000-8000-000000000004": "jeanclaude@wavystudios.com",
};
const users = await sql`select id, email from auth.users where email = any(${Object.values(fixed)})`;
const map = Object.fromEntries(Object.entries(fixed).map(([id, email]) => [id, users.find((u) => u.email === email)?.id]));
const missing = Object.entries(map).filter(([, v]) => !v).map(([k]) => fixed[k]);
if (missing.length) throw new Error(`Create these users in Supabase Auth first: ${missing.join(", ")}`);

for (const file of ["supabase/seed/0001_agency.sql", "supabase/seed/0002_atrakt.sql"]) {
  let text = readFileSync(file, "utf8");
  for (const [k, v] of Object.entries(map)) text = text.replaceAll(k, v);
  // the local-only test user has no auth account on Supabase
  text = text.replace(/,\s*\('00000000-0000-4000-8000-000000000009'[^\n]*\n/, "\n");
  await sql.unsafe(text);
  console.log("seeded", file);
}
await sql.end();
