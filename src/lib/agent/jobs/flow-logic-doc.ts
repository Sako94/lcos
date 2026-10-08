import type { JobContext, JobResult } from "../runner";
import { KlaviyoClient } from "@/lib/integrations/klaviyo";
import { klaviyoKey } from "@/lib/integrations/secrets";
import { draft } from "@/lib/ai";

/**
 * SOP 5 step 2 — draft the documented logic for one flow from its Klaviyo definition.
 * Writes documented_logic only when it is empty (a person's text is never overwritten) and never touches rebuild_status.
 * inputs: { flowId } (our id)
 */
export async function flowLogicDoc(ctx: JobContext): Promise<JobResult> {
  const flowId = String(ctx.inputs.flowId ?? "");
  const flow = (await ctx.tx<{ id: string; externalId: string; name: string; triggerType: string | null; documentedLogic: string | null }[]>`
    select id, external_id, name, trigger_type, documented_logic from public.flows where id = ${flowId} and client_id = ${ctx.clientId}`)[0];
  if (!flow) throw new Error("Flow not found for this client");
  if (flow.documentedLogic && flow.documentedLogic.trim()) return { summary: "Flow already documented by a person; nothing changed" };

  const key = klaviyoKey(ctx.slug);
  if (!key) throw new Error(`Klaviyo API key for ${ctx.slug} is not set`);
  const actions = await new KlaviyoClient(key).flowActions(flow.externalId);
  const outline = actions.map((a, i) => `${i + 1}. ${a.action_type}${a.settings ? " " + JSON.stringify(a.settings).slice(0, 200) : ""}`).join("\n");

  const system = "You document email/SMS automation flows for a marketing agency. Write a plain, factual description of the flow's trigger, filters, timing, and messages from the action list given. Do not invent offers, copy, or performance. Under 180 words. Mark anything you cannot tell from the data as 'not visible in the definition'.";
  const user = `Flow name: ${flow.name}\nTrigger type: ${flow.triggerType ?? "unknown"}\nActions in order:\n${outline}`;
  const d = await draft(system, user, 600);
  const text = d.usedModel
    ? d.text
    : `Trigger: ${flow.triggerType ?? "unknown"}.\nActions (${actions.length}):\n${outline}\n\n(Deterministic outline — no model configured. Review and edit before marking Documented.)`;

  await ctx.tx`update public.flows set documented_logic = ${"[agent draft — review before marking Documented]\n" + text} where id = ${flow.id}`;
  ctx.touched("flow", flow.id);
  return { summary: `Drafted logic for "${flow.name}" (${actions.length} actions, model: ${d.model})`, outputs: { actions: actions.length, model: d.model } };
}
