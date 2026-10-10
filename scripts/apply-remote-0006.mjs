// Apply migration 0006 + operating-model seeds to the production project through the Supabase Management API (HTTPS).
// Usage: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/apply-remote-0006.mjs
import { readFileSync } from "node:fs";
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
const SB = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SB}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
};
const applied = new Set((await q(`select name from public._lcos_migrations`)).map((r) => r.name));
const f = "0006_evidence_and_operating_model.sql";
if (applied.has(f)) console.log("skip", f);
else { await q(readFileSync(`supabase/migrations/${f}`, "utf8") + `\ninsert into public._lcos_migrations (name) values ('${f}');`); console.log("applied", f); }
await q(`grant usage on schema app to authenticated, service_role; grant execute on all functions in schema app to authenticated, service_role;
  grant all on all tables in schema public to authenticated, service_role; grant usage, select on all sequences in schema public to authenticated, service_role;`);
// seeds: map the fixed local admin id to the real one
const users = await q(`select id, email from auth.users where email = 'sako@wavystudios.com'`);
const sako = users[0]?.id; if (!sako) throw new Error("no sako user");
let s4 = readFileSync("supabase/seed/0004_atrakt_operating_model.sql", "utf8").replaceAll("00000000-0000-4000-8000-000000000001", sako);
await q(s4); console.log("seeded 0004");
await q(readFileSync("supabase/seed/0005_sop_updates.sql", "utf8")); console.log("seeded 0005 (SOP updates)");
await q(`update public.clients set approved_domains = '{atrakt.com,www.atrakt.com,shop.atrakt.com}', old_brand_terms = '{Ascend Labs,ascendlabs,ascend.labs}' where slug = 'atrakt';
  insert into public.agent_jobs (client_id, job_type, schedule, enabled) select id, 'link_check', '30 5 * * *', true from public.clients where slug = 'atrakt' on conflict (client_id, job_type) do nothing;`);
console.log("client rules + link_check job set");
const counts = await q(`select (select count(*) from public.metric_definitions) metrics, (select count(*) from public.journeys) journeys, (select count(*) from public.decisions where status='open') open_decisions, (select count(*) from public.sops where wave='mvp') mvp_sops, (select approved_domains from public.clients where slug='atrakt') domains`);
console.log(counts[0]);
