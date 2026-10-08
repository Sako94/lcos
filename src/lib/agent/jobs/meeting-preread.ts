import type { JobContext, JobResult } from "../runner";
import { draft } from "@/lib/ai";

/**
 * SOP 9 — Biweekly meeting pre-read (agent draft).
 * Assembles scorecard, completed work, open decisions, open commitments, and the next cycle plan from records only.
 * Writes pre_read only when empty. inputs: { meetingId }
 */
export async function meetingPreread(ctx: JobContext): Promise<JobResult> {
  const meetingId = String(ctx.inputs.meetingId ?? "");
  const meeting = (await ctx.tx<{ id: string; scheduledAt: string; preRead: string | null }[]>`
    select id, scheduled_at, pre_read from public.meetings where id = ${meetingId} and client_id = ${ctx.clientId}`)[0];
  if (!meeting) throw new Error("Meeting not found for this client");
  if (meeting.preRead?.trim()) return { summary: "Pre-read already written by a person; nothing changed" };

  const audit = (await ctx.tx<{ kind: string; overall: string | null; scores: Record<string, { score?: number; reason?: string }>; periodEnd: string }[]>`
    select kind, overall, scores, period_end from public.audits where client_id = ${ctx.clientId} order by created_at desc limit 1`)[0];
  const done = await ctx.tx<{ title: string; updatedAt: string }[]>`
    select title, updated_at from public.tasks where client_id = ${ctx.clientId} and status = 'done' and updated_at > now() - interval '14 days' order by updated_at desc`;
  const flows = await ctx.tx<{ name: string; rebuildStatus: string }[]>`select name, rebuild_status from public.flows where client_id = ${ctx.clientId} and rebuild_status <> 'not_started' order by name`;
  const briefs = await ctx.tx<{ title: string; status: string }[]>`select title, status from public.briefs where client_id = ${ctx.clientId} and status not in ('cancelled') order by updated_at desc limit 12`;
  const findings = await ctx.tx<{ title: string; severity: number; status: string }[]>`select title, severity, status from public.findings where client_id = ${ctx.clientId} and status in ('new','confirmed') order by severity limit 10`;
  const commitments = await ctx.tx<{ statement: string; owner: string; dueOn: string; status: string }[]>`
    select c.statement, p.full_name as owner, c.due_on, c.status from public.commitments c join public.profiles p on p.id = c.owner_id where c.client_id = ${ctx.clientId} and c.status = 'open' order by c.due_on`;
  const cycle = (await ctx.tx<{ objective: string | null; status: string; startsOn: string; endsOn: string }[]>`
    select objective, status, starts_on, ends_on from public.cycles where client_id = ${ctx.clientId} order by starts_on desc limit 1`)[0];
  const openTasks = await ctx.tx<{ title: string; status: string }[]>`select title, status from public.tasks where client_id = ${ctx.clientId} and status not in ('done','cancelled') and linked_type is distinct from 'agent_run' order by created_at limit 12`;

  const sc = audit ? Object.entries(audit.scores).map(([k, v]) => `${k}: ${v.score ?? "unscored"}${v.reason ? ` (${v.reason})` : ""}`).join("; ") : "no audit yet";
  const raw = [
    `# Pre-read — ${new Date(meeting.scheduledAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`,
    `## Scorecard`, audit ? `Latest ${audit.kind.replace("_", " ")} to ${audit.periodEnd}: overall ${audit.overall ?? "—"}/100. ${sc}` : "No audit on record.",
    `## Completed since last meeting`, done.length ? done.map((t) => `- ${t.title}`).join("\n") : "- Nothing marked done in the last 14 days",
    `## Flow rebuild status`, flows.length ? flows.map((f) => `- ${f.name}: ${f.rebuildStatus.replaceAll("_", " ")}`).join("\n") : "- No flows started",
    `## Campaigns in production`, briefs.length ? briefs.map((b) => `- ${b.title}: ${b.status.replaceAll("_", " ")}`).join("\n") : "- None",
    `## Open findings`, findings.length ? findings.map((f) => `- S${f.severity} ${f.title}`).join("\n") : "- None",
    `## Prior commitments`, commitments.length ? commitments.map((c) => `- ${c.statement} — ${c.owner}, due ${c.dueOn}`).join("\n") : "- None open",
    `## Client dependencies still open`, openTasks.length ? openTasks.map((t) => `- ${t.title}`).join("\n") : "- None",
    `## Next cycle`, cycle ? `${cycle.startsOn} to ${cycle.endsOn} (${cycle.status}): ${cycle.objective ?? ""}` : "No cycle planned",
    `## Decisions needed`, `- (fill in: each with options)`,
  ].join("\n\n");

  const system = "You write a client meeting pre-read for a marketing agency. Keep it under two pages, every number comes from the material given, no new figures, and 'Decisions needed' lists concrete options. Keep the section headings.";
  const d = await draft(system, raw, 1800);
  const text = (d.usedModel && d.text ? d.text : raw) + "\n\n_[agent draft — review and edit before sending]_";
  await ctx.tx`update public.meetings set pre_read = ${text} where id = ${meeting.id}`;
  ctx.touched("meeting", meeting.id);
  return { summary: `Drafted pre-read (model: ${d.model})`, outputs: { model: d.model } };
}
