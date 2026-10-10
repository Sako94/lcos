"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SECTIONS, isAnswered, missingRequired, type AnswerValue, type Question } from "@/lib/onboarding/questions";
import { saveAnswer, submitQuestionnaire } from "./actions";

type SaveState = "saving" | "saved" | { error: string };

const field =
  "w-full rounded-lg border border-line bg-bg-3 px-3 py-2.5 text-[15px] text-fg placeholder:text-fg-muted focus:border-lime focus:outline-none focus:ring-1 focus:ring-lime";

export function OnboardingForm({
  token,
  clientName,
  respondentName,
  initialAnswers,
}: {
  token: string;
  clientName: string;
  respondentName: string | null;
  initialAnswers: Record<string, AnswerValue>;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(initialAnswers);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [step, setStep] = useState(() => {
    if (Object.keys(initialAnswers).length === 0) return 0;
    const i = SECTIONS.findIndex((s) => s.questions.some((q) => !isAnswered(initialAnswers[q.key])));
    return i === -1 ? SECTIONS.length : i;
  });
  const [name, setName] = useState(respondentName ?? "");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timers = useRef(new Map<string, { t: ReturnType<typeof setTimeout>; run: () => Promise<void> }>());
  const inflight = useRef(new Set<Promise<void>>());
  const topRef = useRef<HTMLDivElement>(null);

  const runSave = useCallback(
    (key: string, value: AnswerValue) => {
      const p = (async () => {
        setSaves((s) => ({ ...s, [key]: "saving" }));
        const r = await saveAnswer(token, key, value).catch(() => ({ ok: false as const, error: "Connection problem — try again" }));
        setSaves((s) => ({ ...s, [key]: r.ok ? "saved" : { error: r.error } }));
      })();
      inflight.current.add(p);
      p.finally(() => inflight.current.delete(p));
      return p;
    },
    [token],
  );

  const setAnswer = (key: string, value: AnswerValue, delay = 700) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setSaves((s) => ({ ...s, [key]: "saving" }));
    const prev = timers.current.get(key);
    if (prev) clearTimeout(prev.t);
    const run = () => {
      timers.current.delete(key);
      return runSave(key, value);
    };
    timers.current.set(key, { t: setTimeout(run, delay), run });
  };

  const flush = async () => {
    const pending = [...timers.current.values()];
    pending.forEach((p) => clearTimeout(p.t));
    await Promise.all([...pending.map((p) => p.run()), ...inflight.current]);
  };

  // Save anything pending if the tab is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  });

  const go = async (i: number) => {
    await flush();
    setStep(i);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const missing = missingRequired(answers);
  const answeredCount = SECTIONS.flatMap((s) => s.questions).filter((q) => isAnswered(answers[q.key])).length;
  const total = SECTIONS.reduce((n, s) => n + s.questions.length, 0);
  const anySaving = Object.values(saves).some((s) => s === "saving");
  const anyError = Object.values(saves).some((s) => typeof s === "object");
  const onReview = step === SECTIONS.length;
  const section = SECTIONS[step];

  const submit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    await flush();
    const r = await submitQuestionnaire(token, name);
    setSubmitting(false);
    if (r.ok) router.refresh();
    else setSubmitError(r.error);
  };

  return (
    <main className="page-bg min-h-screen px-4 pb-24 pt-8 sm:pt-12">
      <div ref={topRef} className="mx-auto w-full max-w-2xl">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-fg-muted">
            WAVY<span className="text-lime">·</span>STUDIOS × {clientName}
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Lifecycle onboarding</h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-2">
            About 15–20 minutes. Your answers save as you type, so you can stop and come back with the same link. Skip anything
            you don&apos;t know — only questions marked <span className="text-lime">*</span> are required.
          </p>
          <div className="mt-6 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-3" aria-hidden>
              <div className="h-full rounded-full bg-lime transition-all" style={{ width: `${Math.round((answeredCount / total) * 100)}%` }} />
            </div>
            <span className="font-mono text-[11px] text-fg-muted" aria-live="polite">
              {answeredCount}/{total} answered · {anyError ? <span className="text-coral">not saved</span> : anySaving ? "saving…" : "saved"}
            </span>
          </div>
          <nav className="mt-4 flex flex-wrap gap-1.5" aria-label="Sections">
            {SECTIONS.map((s, i) => {
              const done = s.questions.some((q) => isAnswered(answers[q.key])) && s.questions.filter((q) => q.required).every((q) => isAnswered(answers[q.key]));
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === step ? "step" : undefined}
                  className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset transition ${
                    i === step ? "bg-lime text-bg ring-lime" : "text-fg-2 ring-line hover:ring-fg-muted"
                  }`}
                >
                  {i + 1}. {s.title}
                  {done && i !== step ? <span className="ml-1 text-lime">✓</span> : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => go(SECTIONS.length)}
              aria-current={onReview ? "step" : undefined}
              className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset transition ${onReview ? "bg-lime text-bg ring-lime" : "text-fg-2 ring-line hover:ring-fg-muted"}`}
            >
              Review & submit
            </button>
          </nav>
        </header>

        {!onReview && section ? (
          <section className="mt-8 rounded-2xl border border-line bg-bg-2 p-5 sm:p-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-fg-muted">
              Section {step + 1} of {SECTIONS.length}
            </p>
            <h2 className="mt-2 font-display text-xl font-bold">{section.title}</h2>
            <p className="mt-1 text-sm text-fg-2">{section.intro}</p>
            <div className="mt-6 space-y-7">
              {section.questions.map((q) => (
                <QuestionField key={q.key} q={q} value={answers[q.key]} save={saves[q.key]} onChange={setAnswer} />
              ))}
            </div>
            <div className="mt-8 flex items-center justify-between gap-3 border-t border-line-soft pt-5">
              <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className="text-sm text-fg-2 underline disabled:invisible">
                Back
              </button>
              <button
                type="button"
                onClick={() => go(step + 1)}
                className="rounded-full bg-lime px-5 py-2 font-display text-xs font-semibold uppercase tracking-[0.08em] text-bg hover:bg-lime-dim"
              >
                {step === SECTIONS.length - 1 ? "Review answers" : "Next section"}
              </button>
            </div>
          </section>
        ) : (
          <section className="mt-8 rounded-2xl border border-line bg-bg-2 p-5 sm:p-7">
            <h2 className="font-display text-xl font-bold">Review & submit</h2>
            <ul className="mt-4 divide-y divide-line-soft text-sm">
              {SECTIONS.map((s, i) => {
                const answered = s.questions.filter((q) => isAnswered(answers[q.key])).length;
                const req = s.questions.filter((q) => q.required && !isAnswered(answers[q.key]));
                return (
                  <li key={s.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p>{s.title}</p>
                      {req.length ? <p className="text-xs text-amber-700">{req.length} required question{req.length > 1 ? "s" : ""} left</p> : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[11px] text-fg-muted">{answered}/{s.questions.length}</span>
                      <button type="button" onClick={() => go(i)} className="text-xs underline">
                        {answered ? "Edit" : "Start"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 space-y-2">
              <label htmlFor="submitter" className="block text-sm font-semibold">
                Your name <span className="text-lime">*</span>
              </label>
              <input id="submitter" value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="So we know who filled this in" />
            </div>
            {missing.length ? (
              <p className="mt-4 text-sm text-amber-700">Answer the {missing.length} required question{missing.length > 1 ? "s" : ""} above before submitting.</p>
            ) : null}
            {submitError ? <p className="mt-4 text-sm text-coral">{submitError}</p> : null}
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-line-soft pt-5">
              <button type="button" onClick={() => go(SECTIONS.length - 1)} className="text-sm text-fg-2 underline">
                Back
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || missing.length > 0 || !name.trim()}
                className="rounded-full bg-lime px-5 py-2 font-display text-xs font-semibold uppercase tracking-[0.08em] text-bg hover:bg-lime-dim disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "Submitting…" : "Submit to Wavy"}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function QuestionField({
  q,
  value,
  save,
  onChange,
}: {
  q: Question;
  value: AnswerValue | undefined;
  save: SaveState | undefined;
  onChange: (key: string, value: AnswerValue, delay?: number) => void;
}) {
  const id = `q-${q.key}`;
  const str = typeof value === "string" ? value : "";
  const arr = Array.isArray(value) ? value : [];
  return (
    <div>
      <label htmlFor={q.type === "single" || q.type === "multi" ? undefined : id} id={`${id}-label`} className="block text-[15px] font-semibold leading-snug">
        {q.label}
        {q.required ? <span className="ml-1 text-lime">*</span> : null}
      </label>
      {q.help ? <p className="mt-1 text-xs text-fg-muted">{q.help}</p> : null}
      <div className="mt-2.5">
        {q.type === "short" ? (
          <input id={id} className={field} value={str} placeholder={q.placeholder} maxLength={500} onChange={(e) => onChange(q.key, e.target.value)} />
        ) : q.type === "long" || q.type === "links" ? (
          <textarea
            id={id}
            className={field}
            rows={q.type === "links" ? 3 : 4}
            value={str}
            placeholder={q.placeholder}
            maxLength={8000}
            onChange={(e) => onChange(q.key, e.target.value)}
          />
        ) : (
          <div role={q.type === "single" ? "radiogroup" : "group"} aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
            {q.options!.map((o) => {
              const on = q.type === "single" ? str === o : arr.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  role={q.type === "single" ? "radio" : "checkbox"}
                  aria-checked={on}
                  onClick={() =>
                    q.type === "single"
                      ? onChange(q.key, on ? "" : o, 0)
                      : onChange(q.key, on ? arr.filter((x) => x !== o) : [...arr, o], 0)
                  }
                  className={`rounded-full px-3.5 py-1.5 text-sm ring-1 ring-inset transition ${
                    on ? "bg-lime/10 text-lime ring-lime" : "text-fg-2 ring-line hover:ring-fg-muted"
                  }`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {save && typeof save === "object" ? <p className="mt-1.5 text-xs text-coral">Not saved: {save.error}</p> : null}
    </div>
  );
}
