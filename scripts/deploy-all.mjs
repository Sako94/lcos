#!/usr/bin/env node
// One-shot deploy: Supabase project (create or reuse) → migrations → team users → seed → Vercel project + env + prod deploy.
// Run from the repo root on a machine that can reach supabase.com and vercel.com:
//   SUPABASE_ACCESS_TOKEN=sbp_... VERCEL_TOKEN=... KLAVIYO_API_KEY__atrakt=pk_... node scripts/deploy-all.mjs
// Optional: SUPABASE_ORG_ID, SUPABASE_PROJECT_REF (reuse), SUPABASE_REGION (default us-west-1), CLICKUP_API_TOKEN,
//           ANTHROPIC_API_KEY, VERCEL_SCOPE (team slug), APP_NAME (default wavy-lcos)
// Nothing here is logged except the final URL and the one-time sign-in passwords.
import { execSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(1); } return v; };
const SB = need("SUPABASE_ACCESS_TOKEN");
const VC = need("VERCEL_TOKEN");
const KLAVIYO = process.env.KLAVIYO_API_KEY__atrakt ?? "";
const APP = process.env.APP_NAME ?? "wavy-lcos";
const REGION = process.env.SUPABASE_REGION ?? "us-west-1";
const sbApi = async (path, init = {}) => {
  const r = await fetch(`https://api.supabase.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${SB}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase API ${r.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pw = () => randomBytes(12).toString("base64url");

// ---------- 1. Supabase project ----------
let ref = process.env.SUPABASE_PROJECT_REF;
let dbPass = process.env.SUPABASE_DB_PASSWORD;
if (!ref) {
  const orgs = await sbApi("/organizations");
  const orgId = process.env.SUPABASE_ORG_ID ?? orgs[0]?.id;
  if (!orgId) throw new Error("No Supabase organization found");
  dbPass = pw() + pw();
  console.log(`Creating Supabase project "${APP}" in org ${orgs.find((o) => o.id === orgId)?.name ?? orgId} (${REGION})…`);
  const p = await sbApi("/projects", { method: "POST", body: JSON.stringify({ name: APP, organization_id: orgId, db_pass: dbPass, region: REGION }) });
  ref = p.id;
}
for (let i = 0; i < 60; i++) {
  const p = await sbApi(`/projects/${ref}`);
  if (p.status === "ACTIVE_HEALTHY") break;
  process.stdout.write(`  project ${p.status}…\r`);
  await sleep(10000);
}
console.log(`Supabase project ref: ${ref}`);
const keys = await sbApi(`/projects/${ref}/api-keys`);
const anon = keys.find((k) => k.name === "anon")?.api_key;
const service = keys.find((k) => k.name === "service_role")?.api_key;
if (!anon || !service) throw new Error("Could not read API keys");
const supabaseUrl = `https://${ref}.supabase.co`;
if (!dbPass) throw new Error("Set SUPABASE_DB_PASSWORD when reusing a project");
const pooler = await sbApi(`/projects/${ref}/config/database/pooler`).catch(() => null);
const session = Array.isArray(pooler) ? pooler.find((x) => x.pool_mode === "session") ?? pooler[0] : null;
const dbUrl = session
  ? `postgres://${session.db_user}:${encodeURIComponent(dbPass)}@${session.db_host}:${session.db_port}/${session.db_name ?? "postgres"}`
  : `postgres://postgres:${encodeURIComponent(dbPass)}@db.${ref}.supabase.co:5432/postgres`;

// ---------- 2. migrations ----------
console.log("Applying migrations…");
let r = spawnSync("node", ["scripts/migrate-remote.mjs"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: dbUrl } });
if (r.status !== 0) process.exit(1);

// ---------- 3. team users ----------
const team = [
  { email: "sako@wavystudios.com", name: "Sako Waves", role: "admin" },
  { email: "drew@wavystudios.com", name: "Andrew (Drew) Lauchner", role: "account_lead" },
  { email: "jeanclaude@wavystudios.com", name: "Jean-Claude Mouannes", role: "account_lead" },
  { email: "andre@wavystudios.com", name: "Andre Stock", role: "contributor" },
];
const passwords = [];
for (const u of team) {
  const password = pw();
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json" },
    body: JSON.stringify({ email: u.email, password, email_confirm: true, user_metadata: { full_name: u.name } }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) passwords.push({ email: u.email, password });
  else if (!/already|exists/i.test(JSON.stringify(body))) throw new Error(`User create failed for ${u.email}: ${JSON.stringify(body).slice(0, 200)}`);
}
{
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  for (const u of team) await sql`update public.profiles set role = ${u.role}, full_name = ${u.name} where email = ${u.email}`;
  await sql.end();
}

// ---------- 4. seed ----------
console.log("Seeding agency + Atrakt…");
r = spawnSync("node", ["scripts/seed-remote.mjs"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: dbUrl } });
if (r.status !== 0) process.exit(1);

// ---------- 5. Vercel ----------
const cronSecret = pw() + pw();
const scope = process.env.VERCEL_SCOPE ? ["--scope", process.env.VERCEL_SCOPE] : [];
const vercel = (args, input) => {
  const res = spawnSync("npx", ["--yes", "vercel@latest", ...args, "--token", VC, ...scope], { input, encoding: "utf8", env: { ...process.env, CI: "1" } });
  if (res.status !== 0) { console.error(res.stdout, res.stderr); throw new Error(`vercel ${args[0]} failed`); }
  return res.stdout.trim();
};
console.log("Linking Vercel project…");
vercel(["link", "--yes", "--project", APP]);
const envs = {
  DATABASE_URL: dbUrl,
  AUTH_MODE: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  CRON_SECRET: cronSecret,
  KLAVIYO_API_KEY__atrakt: KLAVIYO,
  CLICKUP_API_TOKEN: process.env.CLICKUP_API_TOKEN ?? "",
  CLICKUP_LIST_ID__atrakt: process.env.CLICKUP_LIST_ID__atrakt ?? "1400430000003190",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  AGENT_MODEL: process.env.AGENT_MODEL ?? "claude-sonnet-4-5",
};
for (const [k, v] of Object.entries(envs)) {
  if (!v) continue;
  spawnSync("npx", ["--yes", "vercel@latest", "env", "rm", k, "production", "--yes", "--token", VC, ...scope], { encoding: "utf8" });
  vercel(["env", "add", k, "production"], v + "\n");
}
console.log("Deploying to Vercel (production)…");
const out = vercel(["deploy", "--prod", "--yes"]);
const url = out.split("\n").reverse().find((l) => l.startsWith("https://")) ?? out;

mkdirSync(".deploy", { recursive: true });
writeFileSync(".deploy/last.json", JSON.stringify({ ref, supabaseUrl, url, deployedAt: new Date().toISOString() }, null, 2));
console.log(`\nDeployed: ${url}`);
console.log(`Supabase: ${supabaseUrl} (ref ${ref})`);
console.log(`Cron: Vercel calls /api/jobs/run daily; CRON_SECRET is set in the project env.`);
console.log(`\nOne-time sign-in passwords (change after first login):`);
for (const p of passwords) console.log(`  ${p.email}  ${p.password}`);
if (!passwords.length) console.log("  (users already existed; passwords unchanged)");
