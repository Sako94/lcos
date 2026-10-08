import type { JobContext, JobResult } from "../runner";
import { draft } from "@/lib/ai";

/**
 * SOP 7 — Campaign brief and copy creation (agent draft).
 * Uses ONLY Approved facts for this client. Produces: brief fields (if empty) and a new immutable copy version
 * whose fact_ids list the approved facts it relied on. The database rejects agent copy that cites non-approved facts.
 * inputs: { briefId }
 */
type Fact = { id: string; category: string; statement: string };

function parseSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = "";
  for (const line of text.split("\n")) {
    const m = line.match(/^##\s*(.+?)\s*$/);
    if (m) { key = m[1].toLowerCase().trim(); out[key] = ""; continue; }
    if (key) out[key] += (out[key] ? "\n" : "") + line;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

export async function briefDraft(ctx: JobContext): Promise<JobResult> {
  const briefId = String(ctx.inputs.briefId ?? "");
  const brief = (await ctx.tx<{ id: string; title: string; goal: string | null; segment: string | null; keyMessage: string | null; offerFactId: string | null; slotChannel: string | null; slotPurpose: string | null; sendOn: string | null }[]>`
    select b.id, b.title, b.goal, b.segment, b.key_message, b.offer_fact_id, s.channel as slot_channel, s.purpose as slot_purpose, s.send_on
    from public.briefs b left join public.calendar_slots s on s.id = b.slot_id where b.id = ${briefId} and b.client_id = ${ctx.clientId}`)[0];
  if (!brief) throw new Error("Brief not found for this client");

  const facts = await ctx.tx<Fact[]>`select id, category, statement from public.facts where client_id = ${ctx.clientId} and status = 'approved' order by category`;
  if (facts.length === 0) throw new Error("No Approved facts for this client; the agent cannot draft without approved context (SOP 7)");
  const offer = brief.offerFactId ? facts.find((f) => f.id === brief.offerFactId) : null;
  if (brief.offerFactId && !offer) throw new Error("The brief's offer fact is not Approved; approve it or remove the offer before drafting");
  const sop = (await ctx.tx<{ decisionRules: string[]; checklist: string[] }[]>`select decision_rules, checklist from public.sops where number = 7`)[0];

  const factList = facts.map((f) => `- [${f.category}] ${f.statement}`).join("\n");
  const system = `You draft email and SMS campaign briefs and copy for an agency. Use ONLY the approved facts provided; do not add claims, numbers, discounts, or product details that are not in them. If the brief has no approved offer, write no discount. Follow these rules:\n${(sop?.decisionRules ?? []).map((r) => "- " + r).join("\n")}\nOutput sections exactly with these headings: ## Goal, ## Segment, ## Key message, ## Proof, ## CTA, ## Design notes, ## Subject lines (3, one per line), ## Preview text, ## Body, ## SMS (under 160 characters, or 'none' if channel is email only).`;
  const user = `Campaign: ${brief.title}\nChannel: ${brief.slotChannel ?? "email"}\nPurpose: ${brief.slotPurpose ?? "unspecified"}\nSend date: ${brief.sendOn ?? "unscheduled"}\nGoal (if set): ${brief.goal ?? ""}\nSegment (if set): ${brief.segment ?? ""}\nApproved offer: ${offer ? offer.statement : "none — no discount"}\n\nApproved facts:\n${factList}`;
  const d = await draft(system, user, 1800);

  let sections: Record<string, string>;
  if (d.usedModel && d.text) {
    sections = parseSections(d.text);
  } else {
    const product = facts.find((f) => f.category === "products_launches")?.statement ?? "the product";
    const audience = facts.find((f) => f.category === "customer_audience")?.statement ?? "the audience";
    sections = {
      goal: brief.goal ?? `Drive ${brief.slotPurpose ?? "engagement"} for ${brief.title}`,
      segment: brief.segment ?? "Engaged subscribers (approved segment to be set)",
      "key message": `${brief.title} — grounded in: ${product}`,
      proof: "Use approved claims only; none beyond the facts listed.",
      cta: "Shop now",
      "design notes": `Audience: ${audience}. Hero product image; one primary CTA; mobile-first.`,
      "subject lines": `${brief.title}\nNew: ${brief.title}\n${brief.title} is here`,
      "preview text": "Details inside.",
      body: `[Deterministic template — no model configured]\n\nHeadline: ${brief.title}\n\nBody draws only on approved facts:\n${factList}\n\nCTA: Shop now`,
      sms: brief.slotChannel === "sms" ? `${brief.title} is live. Shop now: [link] Reply STOP to opt out` : "none",
    };
  }

  // fill empty brief fields only; never overwrite a person's text
  await ctx.tx`update public.briefs set
      goal = coalesce(nullif(goal, ''), ${sections.goal ?? null}),
      segment = coalesce(nullif(segment, ''), ${sections.segment ?? null}),
      key_message = coalesce(nullif(key_message, ''), ${sections["key message"] ?? null}),
      proof = coalesce(nullif(proof, ''), ${sections.proof ?? null}),
      cta = coalesce(nullif(cta, ''), ${sections.cta ?? null}),
      design_notes = coalesce(nullif(design_notes, ''), ${sections["design notes"] ?? null})
    where id = ${brief.id}`;
  const subjects = (sections["subject lines"] ?? "").split("\n").map((s) => s.replace(/^[-\d.\s]+/, "").trim()).filter(Boolean).slice(0, 3);
  const sms = (sections.sms ?? "none").trim().toLowerCase() === "none" ? null : sections.sms;
  const cv = await ctx.tx<{ id: string; version: number }[]>`
    insert into public.copy_versions (brief_id, subject_lines, preview_text, body, sms_body, fact_ids, agent_run_id)
    values (${brief.id}, ${ctx.tx.json(subjects)}, ${sections["preview text"] ?? null}, ${sections.body ?? null}, ${sms}, ${facts.map((f) => f.id)}::uuid[], ${ctx.runId})
    returning id, version`;
  ctx.touched("brief", brief.id);
  ctx.touched("copy_version", cv[0].id);
  return { summary: `Drafted brief and copy v${cv[0].version} for "${brief.title}" from ${facts.length} approved facts (model: ${d.model})`, outputs: { version: cv[0].version, factsUsed: facts.length, model: d.model } };
}
