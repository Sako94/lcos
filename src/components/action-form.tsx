"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

export type ActionResult = { ok: true } | { ok: false; error: string };

type FormAction = (formData: FormData) => Promise<ActionResult>;

/** A form around a server action that shows the database's rule errors inline. */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = true,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: { result: ActionResult | null; successes: number }, formData: FormData) => {
      const result = await action(formData);
      return { result, successes: prev.successes + (result.ok ? 1 : 0) };
    },
    { result: null as ActionResult | null, successes: 0 },
  );
  return (
    <form
      action={formAction}
      className={className}
      key={resetOnSuccess ? state.successes : "form"}
      aria-busy={pending}
    >
      {children}
      {state.result && !state.result.ok ? <p className="mt-2 text-sm text-red-700">{state.result.error}</p> : null}
    </form>
  );
}

/** One-click action (status change, approve, dismiss) with inline error. */
export function ActionButton({
  action,
  children,
  className,
  confirm,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  className: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(async () => action(), null as ActionResult | null);
  return (
    <form
      action={formAction}
      className="inline"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <button className={className} disabled={pending}>
        {children}
      </button>
      {state && !state.ok ? <span className="ml-2 text-xs text-red-700">{state.error}</span> : null}
    </form>
  );
}
