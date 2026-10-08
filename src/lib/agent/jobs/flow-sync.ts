import type { JobContext, JobResult } from "../runner";
import { KlaviyoClient } from "@/lib/integrations/klaviyo";
import { klaviyoKey } from "@/lib/integrations/secrets";

/** Read-only sync of the Klaviyo flow inventory into public.flows (never touches rebuild_status or documented_logic). */
export async function flowSync(ctx: JobContext): Promise<JobResult> {
  const key = klaviyoKey(ctx.slug);
  if (!key) throw new Error(`Klaviyo API key for ${ctx.slug} is not set (KLAVIYO_API_KEY__${ctx.slug})`);
  const k = new KlaviyoClient(key);
  const flows = await k.flows();
  let upserts = 0;
  for (const f of flows) {
    await ctx.tx`
      insert into public.flows (client_id, external_id, name, trigger_type, external_status, archived, last_synced_at)
      values (${ctx.clientId}, ${f.id}, ${f.name}, ${f.trigger_type}, ${f.status}, ${f.archived}, now())
      on conflict (client_id, external_id) do update set name = excluded.name, trigger_type = excluded.trigger_type,
        external_status = excluded.external_status, archived = excluded.archived, last_synced_at = now()`;
    ctx.touched("flow", f.id);
    upserts++;
  }
  await ctx.tx`update public.integrations set status = 'connected', last_verified_at = now() where client_id = ${ctx.clientId} and system = 'klaviyo'`;
  return { summary: `Synced ${upserts} flows from Klaviyo`, outputs: { count: upserts } };
}
