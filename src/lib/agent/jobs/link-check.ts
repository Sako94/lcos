import type { JobContext, JobResult } from "../runner";
import { KlaviyoClient } from "@/lib/integrations/klaviyo";
import { klaviyoKey } from "@/lib/integrations/secrets";
import { createHash } from "node:crypto";

/**
 * SOP 5 / SOP 8 — nightly message-level check of every live flow.
 * Syncs flow messages (subject, sender, links), stores each message's HTML as an immutable snapshot when it changes,
 * and opens Severity 1 findings for links to unapproved domains, old-brand text, and old-brand sender names.
 * Findings point at the exact flow message and the snapshot that shows the defect. Read-only against Klaviyo.
 */
type Check = { old_domain: string[]; old_brand: string[]; sender_old_brand: boolean; social: string[]; unreachable: string[]; checked_at: string };

const SKIP_HOST = /(^|\.)(klaviyo\.com|klaviyomail\.com|klclick\d*\.com|trk\.klclick|list-manage\.com|w3\.org)$/i;
const SOCIAL_HOST = /(^|\.)(tiktok\.com|instagram\.com|facebook\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|pinterest\.com|linkedin\.com|threads\.net)$/i;
const TEMPLATE_TAG = /[{%]/;

export function extractLinks(html: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (/^(mailto:|tel:|sms:|#|javascript:)/i.test(href)) continue;
    out.push({ href, text: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  return out;
}

export function hostOf(href: string): string | null {
  if (TEMPLATE_TAG.test(href)) return null; // {{ unsubscribe_link }} and friends resolve at send time
  try { return new URL(href).hostname.toLowerCase(); } catch { return null; }
}

export function runChecks(opts: { html: string | null; subject: string | null; fromLabel: string | null; links: { href: string }[]; approvedDomains: string[]; oldBrandTerms: string[] }): Omit<Check, "unreachable" | "checked_at"> {
  const approved = opts.approvedDomains.map((d) => d.toLowerCase().replace(/^www\./, ""));
  const isApproved = (h: string) => approved.length === 0 || approved.some((d) => h === d || h.endsWith("." + d));
  const hosted = opts.links.map((l) => ({ l, h: hostOf(l.href) })).filter(({ h }) => h && !SKIP_HOST.test(h));
  // social profiles are links out by design; they are listed, not flagged (an old-brand handle still trips the old_brand check below)
  const social = [...new Set(hosted.filter(({ h }) => SOCIAL_HOST.test(h!)).map(({ l }) => l.href))];
  const old_domain = [...new Set(hosted.filter(({ h }) => !SOCIAL_HOST.test(h!) && !isApproved(h!)).map(({ l }) => l.href))];
  const text = `${opts.subject ?? ""}\n${social.join(" ")}\n${(opts.html ?? "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ")}`;
  const old_brand = opts.oldBrandTerms.filter((t) => t && new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text));
  const sender_old_brand = opts.oldBrandTerms.some((t) => t && (opts.fromLabel ?? "").toLowerCase().includes(t.toLowerCase()));
  return { old_domain, old_brand, sender_old_brand, social };
}

async function reachable(href: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(href, { method: "HEAD", redirect: "follow", signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    return res.status < 400;
  } catch {
    return false;
  }
}

export async function linkCheck(ctx: JobContext): Promise<JobResult> {
  const key = klaviyoKey(ctx.slug);
  if (!key) throw new Error(`Klaviyo API key for ${ctx.slug} is not set (KLAVIYO_API_KEY__${ctx.slug})`);
  const k = new KlaviyoClient(key);
  const client = (await ctx.tx<{ approvedDomains: string[]; oldBrandTerms: string[] }[]>`select approved_domains, old_brand_terms from public.clients where id = ${ctx.clientId}`)[0];
  const flows = await ctx.tx<{ id: string; externalId: string; name: string }[]>`
    select id, external_id, name from public.flows where client_id = ${ctx.clientId} and not archived and external_status = 'live' order by name`;

  let messages = 0, snapshots = 0, findingsCreated = 0;
  const defects: string[] = [];
  const hostCache = new Map<string, boolean>();

  for (const flow of flows) {
    const actions = await k.flowActions(flow.externalId);
    for (const a of actions.filter((a) => /SEND_(EMAIL|SMS)/i.test(a.action_type))) {
      const msgs = await k.flowActionMessages(a.id);
      for (const m of msgs) {
        const channel = /sms/i.test(m.channel) ? "sms" : "email";
        const tpl = channel === "email" ? await k.flowMessageTemplateHtml(m.id) : null;
        const html = tpl?.html ?? null;
        const links = html ? extractLinks(html) : [];
        const base = runChecks({ html, subject: m.content.subject ?? null, fromLabel: m.content.from_label ?? null, links, approvedDomains: client.approvedDomains, oldBrandTerms: client.oldBrandTerms });
        // reach check only for off-domain hosts, one request per host, capped
        const unreachable: string[] = [];
        for (const href of base.old_domain.slice(0, 10)) {
          const h = hostOf(href)!;
          if (!hostCache.has(h)) hostCache.set(h, await reachable(`https://${h}/`));
          if (!hostCache.get(h)) unreachable.push(href);
        }
        const checks: Check = { ...base, unreachable, checked_at: new Date().toISOString() };

        // snapshot the HTML only when it changed since the last stored copy
        let snapshotId: string | null = null;
        if (html) {
          const hash = createHash("sha256").update(html).digest("hex");
          const prev = await ctx.tx<{ id: string }[]>`
            select id from public.snapshots where client_id = ${ctx.clientId} and kind = 'flow_message_html' and content_hash = ${hash} order by captured_at desc limit 1`;
          snapshotId = prev[0]?.id ?? (await ctx.snapshot({ sourceSystem: "klaviyo", kind: "flow_message_html", payload: { message_id: m.id, flow_id: flow.externalId, html }, rowCount: links.length }));
          if (!prev[0]) snapshots++;
        }
        const row = await ctx.tx<{ id: string }[]>`
          insert into public.flow_messages (client_id, flow_id, external_id, action_id, channel, name, subject, preview_text, from_label, from_email, external_status, links, checks, html_snapshot_id, last_synced_at)
          values (${ctx.clientId}, ${flow.id}, ${m.id}, ${a.id}, ${channel}::app.channel, ${m.name}, ${m.content.subject ?? null}, ${m.content.preview_text ?? null}, ${m.content.from_label ?? null}, ${m.content.from_email ?? null}, 'live',
                  ${ctx.tx.json(links)}, ${ctx.tx.json(checks)}, ${snapshotId}, now())
          on conflict (client_id, external_id) do update set flow_id = excluded.flow_id, action_id = excluded.action_id, name = excluded.name, subject = excluded.subject,
            preview_text = excluded.preview_text, from_label = excluded.from_label, from_email = excluded.from_email, external_status = 'live',
            links = excluded.links, checks = excluded.checks, html_snapshot_id = coalesce(excluded.html_snapshot_id, public.flow_messages.html_snapshot_id), last_synced_at = now()
          returning id`;
        const messageId = row[0].id;
        ctx.touched("flow_message", messageId);
        messages++;

        const problems: { title: string; detail: string }[] = [];
        if (checks.old_domain.length) problems.push({ title: `"${m.name}" in ${flow.name} links to an unapproved domain`, detail: `${checks.old_domain.length} link(s) off the approved domain list: ${checks.old_domain.slice(0, 5).join(", ")}${checks.unreachable.length ? `. Unreachable: ${checks.unreachable.slice(0, 3).join(", ")}` : ""}` });
        if (checks.old_brand.length) problems.push({ title: `"${m.name}" in ${flow.name} still contains old-brand text`, detail: `Terms found: ${checks.old_brand.join(", ")}` });
        if (checks.sender_old_brand) problems.push({ title: `"${m.name}" in ${flow.name} sends from an old-brand sender name`, detail: `From label: ${m.content.from_label}` });
        for (const p of problems) {
          defects.push(p.title);
          const dup = await ctx.tx<{ id: string }[]>`select id from public.findings where client_id = ${ctx.clientId} and flow_message_id = ${messageId} and title = ${p.title} and status in ('new','confirmed','promoted')`;
          if (dup.length) continue;
          await ctx.tx`insert into public.findings (client_id, area, title, detail, severity, confidence, impact, effort, status, next_action, evidence_class, snapshot_id, flow_message_id, readiness, estimate_hours_min, estimate_hours_max, agent_run_id, evidence_url)
            values (${ctx.clientId}, 'flows', ${p.title}, ${p.detail}, 1, 'high', 4, 1, 'new', 'Propose a change on the flow: replace the link or text, QA a test send, cut over with a note (SOP 5)', 'observed', ${snapshotId}, ${messageId},
                    'Confirm the intended destination for each link with the client', 1, 2, ${ctx.runId}, ${`https://www.klaviyo.com/flow/${flow.externalId}/edit`})`;
          findingsCreated++;
        }
      }
    }
  }
  // messages no longer present in a live flow
  await ctx.tx`update public.flow_messages set external_status = 'not_live' where client_id = ${ctx.clientId} and (last_synced_at is null or last_synced_at < now() - interval '1 hour')`;
  return {
    summary: `Checked ${messages} live flow messages across ${flows.length} flows: ${defects.length} defect(s), ${findingsCreated} new finding(s), ${snapshots} new HTML snapshot(s)`,
    outputs: { messages, flows: flows.length, defects, findingsCreated, snapshots, approvedDomains: client.approvedDomains, oldBrandTerms: client.oldBrandTerms },
  };
}
