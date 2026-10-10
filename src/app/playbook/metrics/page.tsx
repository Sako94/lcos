import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { Card, PageHeader, Table } from "@/components/ui";

/** SOP 18 — the metric dictionary. One definition per number the app shows; caveats live here, not on every figure. */
export default async function MetricsPage() {
  const user = await requireUser();
  const metrics = await withUser(user.id, (tx) => tx<{ key: string; name: string; definition: string; timeBasis: string; source: string; caveat: string | null; unit: string }[]>`
    select key, name, definition, time_basis, source, caveat, unit from public.metric_definitions order by name`);
  return (
    <>
      <PageHeader title="Metric dictionary" subtitle="Every number in a scorecard, finding, fact or target names one of these keys. Two systems quoting different figures for the same account is a definitions problem; this page is where that gets settled." />
      <Card>
        <Table head={["Metric", "Definition", "Time basis", "Source", "Caveat"]}>
          {metrics.map((m) => (
            <tr key={m.key}>
              <td className="align-top"><p className="font-medium">{m.name}</p><p className="mono text-[11px] text-fg-muted">{m.key} · {m.unit}</p></td>
              <td className="align-top text-fg-2">{m.definition}</td>
              <td className="align-top"><span className="mono text-xs">{m.timeBasis}</span></td>
              <td className="align-top text-fg-2">{m.source}</td>
              <td className="align-top text-fg-2">{m.caveat ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
