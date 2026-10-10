import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { QUESTIONS } from "@/lib/onboarding/questions";
import { Card, Chip, Empty, PageHeader, Table, btnPrimary, fmtDate, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { linkBase } from "@/lib/onboarding/url";
import { createLink, extendLink, setLinkStatus } from "./actions";

type FormRow = {
  id: string; token: string; status: string; respondentName: string | null; respondentEmail: string | null; note: string | null;
  createdAt: Date; expiresAt: Date; firstOpenedAt: Date | null; lastSavedAt: Date | null; submittedAt: Date | null;
  submittedByName: string | null; expired: boolean; createdBy: string | null; answered: number; pending: number; promoted: number;
};

export default async function OnboardingListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const forms = await tx<FormRow[]>`
      select f.id, f.token, f.status, f.expires_at <= now() as expired, f.respondent_name, f.respondent_email, f.note, f.created_at, f.expires_at, f.first_opened_at,
             f.last_saved_at, f.submitted_at, f.submitted_by_name, p.full_name as created_by,
             (select count(*)::int from public.onboarding_answers a where a.form_id = f.id) as answered,
             (select count(*)::int from public.onboarding_answers a where a.form_id = f.id and a.review_status = 'pending') as pending,
             (select count(*)::int from public.onboarding_answers a where a.form_id = f.id and a.review_status = 'promoted') as promoted
      from public.onboarding_forms f left join public.profiles p on p.id = f.created_by
      where f.client_id = ${client.id} order by f.created_at desc`;
    return { role, forms };
  });
  const canManage = d.role === "admin" || d.role === "account_lead";
  const base = await linkBase();

  return (
    <>
      <PageHeader
        title={`${client.name} · Onboarding questionnaire`}
        subtitle="Send the client a private link (no login). Their answers come back as evidence: promote each one into a Proposed fact in the Source of Truth, or skip it."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Links">
          {d.forms.length === 0 ? <Empty>No onboarding links yet. Create one to send to the client.</Empty> : (
            <Table head={["Sent to", "Status", "Progress", "Dates", ""]}>
              {d.forms.map((f) => {
                const expired = f.expired && (f.status === "sent" || f.status === "in_progress");
                const url = `${base}/onboard/${f.token}`;
                return (
                  <tr key={f.id} className="align-top">
                    <td className="py-3 pr-4">
                      <Link href={`/clients/${slug}/onboarding/${f.id}`} className="font-semibold underline">
                        {f.respondentName ?? f.submittedByName ?? "Unnamed link"}
                      </Link>
                      {f.respondentEmail ? <p className="text-xs text-fg-muted">{f.respondentEmail}</p> : null}
                      {f.note ? <p className="text-xs text-fg-muted">{f.note}</p> : null}
                    </td>
                    <td className="py-3 pr-4">
                      <Chip value={expired ? "error" : f.status} label={expired ? "expired" : f.status.replace("_", " ")} />
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      {f.answered}/{QUESTIONS.length} answered
                      {f.status === "submitted" || f.status === "reviewed" ? (
                        <span className="block text-fg-muted">{f.promoted} promoted · {f.pending} to review</span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-xs text-fg-muted">
                      <span className="block">Created {fmtDate(f.createdAt)}{f.createdBy ? ` by ${f.createdBy}` : ""}</span>
                      {f.firstOpenedAt ? <span className="block">Opened {fmtDate(f.firstOpenedAt)}</span> : <span className="block">Not opened yet</span>}
                      {f.submittedAt ? <span className="block">Submitted {fmtDate(f.submittedAt)}</span> : (
                        <span className="block">Expires {fmtDate(f.expiresAt)}</span>
                      )}
                    </td>
                    <td className="py-3 text-right text-xs">
                      <div className="flex flex-col items-end gap-1">
                        {f.status === "sent" || f.status === "in_progress" ? (
                          <>
                            <CopyButton text={url} className="underline" />
                            {canManage ? <ActionButton action={extendLink.bind(null, slug, f.id)} className="underline">extend 30 days</ActionButton> : null}
                            {canManage ? (
                              <ActionButton action={setLinkStatus.bind(null, slug, f.id, "revoked")} className="text-coral underline" confirm="Revoke this link? The client will no longer be able to open it.">
                                revoke
                              </ActionButton>
                            ) : null}
                          </>
                        ) : (
                          <Link href={`/clients/${slug}/onboarding/${f.id}`} className="underline">
                            {f.status === "submitted" ? "review answers" : "view"}
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          {canManage ? (
            <Card title="New link">
              <ActionForm action={createLink.bind(null, slug)} className="space-y-2">
                <input type="hidden" name="client_id" value={client.id} />
                <input name="respondent_name" placeholder="Who it's for (name)" className={input} />
                <input name="respondent_email" type="email" placeholder="Their email (optional)" className={input} />
                <input name="note" placeholder="Internal note (optional)" className={input} />
                <button className={btnPrimary}>Create link</button>
                <p className="text-xs text-fg-muted">The link works for 30 days and can be extended. Copy it from the list and send it yourself — LCOS never emails clients.</p>
              </ActionForm>
            </Card>
          ) : null}
          <Card title="How review works">
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-fg-2">
              <li>The client fills the form; answers autosave until they submit.</li>
              <li>Submitting creates a <em>questionnaire</em> source for this client.</li>
              <li>A lead promotes each useful answer into a Proposed fact citing that source, or skips it.</li>
              <li>Facts then follow the normal Verify → Approve flow. Sensitive categories still need an admin.</li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
