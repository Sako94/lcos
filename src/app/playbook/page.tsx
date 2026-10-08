import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { Card, Chip, PageHeader } from "@/components/ui";

type Sop = { number: number; name: string; area: string; wave: string; purpose: string; triggerText: string; inputs: string[]; steps: string[]; decisionRules: string[]; output: string; checklist: string[]; ownerRole: string; approvalRole: string | null; screen: string | null; status: string; version: number };

export default async function Playbook() {
  const user = await requireUser();
  const sops = await withUser(user.id, (tx) => tx<Sop[]>`
    select number, name, area, wave, purpose, trigger_text, inputs, steps, decision_rules, output, checklist, owner_role, approval_role, screen, status, version from public.sops order by number`);
  const template = await withUser(user.id, (tx) => tx<{ version: number; areas: { key: string; name: string; weight: number; checks: string }[] }[]>`select version, areas from public.audit_templates order by version desc limit 1`);
  return (
    <>
      <PageHeader title="Playbook and SOP library" subtitle="Agency standards the agent and the team both read. Client-specific exceptions link to an SOP from the client workspace." />
      <Card title={`Audit template v${template[0]?.version ?? "—"}`} className="mb-6">
        <ul className="grid gap-1 text-sm md:grid-cols-2">
          {template[0]?.areas.map((a) => <li key={a.key}><span className="font-medium">{a.name}</span> · weight {a.weight}<span className="block text-xs text-neutral-500">{a.checks}</span></li>)}
        </ul>
      </Card>
      <div className="space-y-4">
        {sops.map((s) => (
          <Card key={s.number}>
            <details open={s.wave === "mvp"}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="font-medium">SOP {s.number} · {s.name}</span>
                <Chip value={s.wave} label={s.wave === "mvp" ? "MVP" : s.wave} />
                <Chip value={s.status} />
                <span className="text-xs text-neutral-500">{s.area} · owner {s.ownerRole.replace("_", " ")}{s.approvalRole ? ` · approval ${s.approvalRole.replace("_", " ")}` : ""} · screen {s.screen ?? "—"} · v{s.version}</span>
              </summary>
              <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
                <div>
                  <p><span className="font-medium">Purpose.</span> {s.purpose}</p>
                  <p className="mt-1"><span className="font-medium">Trigger.</span> {s.triggerText}</p>
                  <p className="mt-1"><span className="font-medium">Output.</span> {s.output}</p>
                  {s.inputs.length ? <><p className="mt-2 font-medium">Inputs</p><ul className="list-disc pl-5">{s.inputs.map((x) => <li key={x}>{x}</li>)}</ul></> : null}
                  {s.decisionRules.length ? <><p className="mt-2 font-medium">Decision rules</p><ul className="list-disc pl-5">{s.decisionRules.map((x) => <li key={x}>{x}</li>)}</ul></> : null}
                </div>
                <div>
                  {s.steps.length ? <><p className="font-medium">Steps</p><ol className="list-decimal pl-5">{s.steps.map((x) => <li key={x}>{x}</li>)}</ol></> : <p className="text-neutral-500">Steps to be written (wave {s.wave}).</p>}
                  {s.checklist.length ? <><p className="mt-2 font-medium">Quality checklist</p><ul className="list-disc pl-5">{s.checklist.map((x) => <li key={x}>{x}</li>)}</ul></> : null}
                </div>
              </div>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
