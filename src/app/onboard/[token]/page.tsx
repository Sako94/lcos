import type { Metadata } from "next";
import { loadLinkForm } from "@/lib/onboarding/link";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Onboarding · Wavy Studios", robots: { index: false, follow: false } };

export default async function OnboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await loadLinkForm(token);

  if (!loaded) return <Notice title="Link not found">Check that you copied the whole link, or ask your Wavy Studios contact for a new one.</Notice>;
  const { form, answers } = loaded;
  if (form.status === "revoked") return <Notice title="This link is no longer active">Ask your Wavy Studios contact for a new link.</Notice>;
  if (form.status === "submitted" || form.status === "reviewed") {
    return (
      <Notice title="Thank you — we’ve got it">
        {form.submittedByName ? `${form.submittedByName}, your` : "Your"} answers for {form.clientName} came through
        {form.submittedAt ? ` on ${form.submittedAt.toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}. The Wavy team is
        reviewing them now and will follow up with any questions. If you need to change something, reply to your Wavy contact and we’ll reopen the form.
      </Notice>
    );
  }
  if (form.expired) return <Notice title="This link has expired">Ask your Wavy Studios contact to extend it. Your saved answers are kept.</Notice>;

  return <OnboardingForm token={token} clientName={form.clientName} respondentName={form.respondentName} initialAnswers={answers} />;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="page-bg flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-bg-2 p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-fg-muted">Wavy Studios · Client onboarding</p>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-2">{children}</p>
      </div>
    </main>
  );
}
