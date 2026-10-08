import type { JobContext, JobResult } from "../runner";
import { KlaviyoClient, type ReportRow } from "@/lib/integrations/klaviyo";
import { klaviyoKey } from "@/lib/integrations/secrets";

/**
 * SOP 3 — Account health and performance review (agent pre-fill).
 * Reads Klaviyo flow and campaign reports, writes a health_review audit with data-backed scores
 * (deliverability, flows, campaigns) and findings by rule. Humans confirm, dismiss, or promote.
 */
type Agg = { recipients: number; delivered: number; opens: number; clicks: number; conversions: number; revenue: number; bounceW: number; spamW: number; unsubW: number };

function agg(rows: ReportRow[], keyOf: (r: ReportRow) => string): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const r of rows) {
    const k = keyOf(r);
    const s = r.statistics;
    const a = m.get(k) ?? { recipients: 0, delivered: 0, opens: 0, clicks: 0, conversions: 0, revenue: 0, bounceW: 0, spamW: 0, unsubW: 0 };
    const rec = s.recipients ?? 0;
    a.recipients += rec;
    a.delivered += s.delivered ?? 0;
    a.opens += s.opens_unique ?? 0;
    a.clicks += s.clicks_unique ?? 0;
    a.conversions += s.conversions ?? 0;
    a.revenue += s.conversion_value ?? 0;
    a.bounceW += (s.bounce_rate ?? 0) * rec;
    a.spamW += (s.spam_complaint_rate ?? 0) * rec;
    a.unsubW += (s.unsubscribe_rate ?? 0) * rec;
    m.set(k, a);
  }
  return m;
}
const rate = (n: number, d: number) => (d > 0 ? n / d : 0);

export async function healthReview(ctx: JobContext): Promise<JobResult> {
  const key = klaviyoKey(ctx.slug);
  if (!key) throw new Error(`Klaviyo API key for ${ctx.slug} is not set (KLAVIYO_API_KEY__${ctx.slug}); the health review needs read access`);
  const k = new KlaviyoClient(key);
  const metricId = await k.placedOrderMetricId();
  if (!metricId) throw new Error("No 'Placed Order' metric in this Klaviyo account; cannot compute conversions");

  const [flow7, flow30, flow90, camp30] = await Promise.all([
    k.flowReport({ key: "last_7_days" }, metricId),
    k.flowReport({ key: "last_30_days" }, metricId),
    k.flowReport({ key: "last_90_days" }, metricId),
    k.campaignReport({ key: "last_30_days" }, metricId),
  ]);
  const byFlow7 = agg(flow7, (r) => r.groupings.flow_id);
  const byFlow30 = agg(flow30, (r) => r.groupings.flow_id);
  const byFlow90 = agg(flow90, (r) => r.groupings.flow_id);
  const all30 = agg([...flow30, ...camp30], () => "all").get("all")!;
  const flowsAll30 = agg(flow30, () => "all").get("all") ?? all30;
  const campsAll30 = agg(camp30, () => "all").get("all");

  const flows = await ctx.tx<{ id: string; externalId: string; name: string; externalStatus: string | null }[]>`
    select id, external_id, name, external_status from public.flows where client_id = ${ctx.clientId} and not archived`;

  const findings: { area: string; title: string; detail: string; severity: number; confidence: "low" | "medium" | "high"; impact: number; effort: number; next: string }[] = [];
  const ev = `https://www.klaviyo.com/analytics/reports`;

  // Rule: live flow with zero sends in 7 days
  for (const f of flows.filter((f) => f.externalStatus === "live")) {
    const a7 = byFlow7.get(f.externalId);
    if (!a7 || a7.recipients === 0) {
      findings.push({ area: "flows", title: `Live flow "${f.name}" sent nothing in the last 7 days`, detail: "A live flow with no recipients usually means a broken trigger, an empty audience, or a filter that excludes everyone.", severity: 2, confidence: "high", impact: 3, effort: 2, next: `Open the flow in Klaviyo and check trigger, filters, and recent events` });
    }
    const a30 = byFlow30.get(f.externalId), a90 = byFlow90.get(f.externalId);
    if (a30 && a90 && a30.recipients >= 50 && a90.recipients >= 150) {
      const c30 = rate(a30.conversions, a30.recipients), c90 = rate(a90.conversions, a90.recipients);
      if (c90 > 0 && c30 < c90 / 2) {
        findings.push({ area: "flows", title: `"${f.name}" placed-order rate fell to ${(c30 * 100).toFixed(2)}% (90-day avg ${(c90 * 100).toFixed(2)}%)`, detail: "Rate is below half its 90-day average over the last 30 days.", severity: 2, confidence: "medium", impact: 4, effort: 3, next: "Check offer, links, and audience changes in the flow; compare message-level stats" });
      }
    }
  }
  // Deliverability rules (volume-weighted over 30 days)
  const spam = rate(all30.spamW, all30.recipients), unsub = rate(all30.unsubW, all30.recipients), bounce = rate(all30.bounceW, all30.recipients);
  if (spam > 0.0008) findings.push({ area: "deliverability", title: `Spam complaint rate ${(spam * 100).toFixed(3)}% over 30 days (rule: above 0.08%)`, detail: "Severity 1: deliverability. Goes to the admin the same day.", severity: 1, confidence: "high", impact: 5, effort: 2, next: "Review recent sends by segment; tighten engagement windows; check list sources" });
  if (unsub > 0.005) findings.push({ area: "deliverability", title: `Unsubscribe rate ${(unsub * 100).toFixed(2)}% over 30 days (rule: above 0.5%)`, detail: "High unsubscribes point to frequency, relevance, or audience mismatch.", severity: 1, confidence: "high", impact: 4, effort: 2, next: "Identify the sends driving unsubscribes; review cadence against SOP 6" });
  if (bounce > 0.02) findings.push({ area: "deliverability", title: `Bounce rate ${(bounce * 100).toFixed(2)}% over 30 days`, detail: "Above 2% suggests list hygiene or authentication problems.", severity: 2, confidence: "medium", impact: 3, effort: 2, next: "Check sending domain status and suppress hard bounces" });
  // Campaign cadence rule
  const campaignCount = new Set(camp30.map((r) => r.groupings.campaign_id)).size;
  if (campaignCount < 8) findings.push({ area: "campaigns", title: `Only ${campaignCount} campaigns sent in the last 30 days`, detail: "SOP 6 target once fully transitioned is 12 to 16 per month.", severity: 3, confidence: "high", impact: 3, effort: 3, next: "Review the calendar for the cycle; confirm transition status with the incumbent" });

  // Scores (1-5) from data for the three data-backed areas
  const flowShare = rate(flowsAll30.revenue, all30.revenue);
  const scoreFlows = flows.filter((f) => f.externalStatus === "live").length >= 12 && flowShare >= 0.5 ? 5 : flowShare >= 0.4 ? 4 : flowShare >= 0.3 ? 3 : flowShare >= 0.2 ? 2 : 1;
  const scoreDeliv = spam > 0.001 || bounce > 0.03 ? 1 : spam > 0.0005 ? 2 : spam > 0.0002 ? 3 : bounce > 0.01 ? 4 : 5;
  const campConv = campsAll30 ? rate(campsAll30.conversions, campsAll30.recipients) : 0;
  const scoreCamp = campaignCount >= 12 && campConv >= 0.01 ? 5 : campaignCount >= 8 ? 4 : campaignCount >= 4 ? 3 : campaignCount >= 1 ? 2 : 1;
  const mk = (score: number, reason: string) => ({ score, reason, evidence_url: ev, set_by_kind: "agent", verified: false, set_at: new Date().toISOString() });
  const scores = {
    deliverability: mk(scoreDeliv, `30-day spam ${(spam * 100).toFixed(3)}%, bounce ${(bounce * 100).toFixed(2)}%, unsub ${(unsub * 100).toFixed(2)}%`),
    flows: mk(scoreFlows, `${flows.filter((f) => f.externalStatus === "live").length} live flows; flows are ${(flowShare * 100).toFixed(0)}% of attributed revenue (30 days)`),
    campaigns: mk(scoreCamp, `${campaignCount} campaigns in 30 days; placed-order rate ${(campConv * 100).toFixed(2)}%`),
  };

  const periodEnd = new Date().toISOString().slice(0, 10);
  const periodStart = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const audit = await ctx.tx<{ id: string }[]>`
    insert into public.audits (client_id, template_version, kind, period_start, period_end, status, scores, agent_run_id)
    values (${ctx.clientId}, (select max(version) from public.audit_templates), 'health_review', ${periodStart}::date, ${periodEnd}::date, 'prefilled', ${ctx.tx.json(scores)}, ${ctx.runId})
    returning id`;
  ctx.touched("audit", audit[0].id);

  let created = 0;
  for (const f of findings) {
    const dup = await ctx.tx<{ id: string }[]>`select id from public.findings where client_id = ${ctx.clientId} and title = ${f.title} and status in ('new','confirmed') and created_at > now() - interval '7 days'`;
    if (dup.length) continue;
    await ctx.tx`insert into public.findings (client_id, audit_id, area, title, detail, evidence_url, severity, confidence, impact, effort, next_action, agent_run_id)
      values (${ctx.clientId}, ${audit[0].id}, ${f.area}, ${f.title}, ${f.detail}, ${ev}, ${f.severity}, ${f.confidence}::app.confidence, ${f.impact}, ${f.effort}, ${f.next}, ${ctx.runId})`;
    created++;
  }
  await ctx.tx`update public.integrations set status = 'connected', last_verified_at = now() where client_id = ${ctx.clientId} and system = 'klaviyo'`;

  return {
    summary: `Health review: ${created} new findings (${findings.length - created} duplicates skipped); scores deliverability ${scoreDeliv}, flows ${scoreFlows}, campaigns ${scoreCamp}`,
    outputs: {
      snapshot: {
        period: { start: periodStart, end: periodEnd },
        totals30: { recipients: all30.recipients, conversions: all30.conversions, revenue: all30.revenue, spam, unsub, bounce },
        flowShareOfRevenue: flowShare, campaignCount, liveFlows: flows.filter((f) => f.externalStatus === "live").length,
      },
      scores,
      candidateFindings: findings.map((f) => f.title),
    },
  };
}
