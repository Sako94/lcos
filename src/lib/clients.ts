import "server-only";
import { notFound } from "next/navigation";
import { withUser, type Tx } from "./db";
import type { CurrentUser } from "./auth";

export type Client = { id: string; name: string; slug: string; website: string | null; objective: string | null };

export async function getClient(user: CurrentUser, slug: string): Promise<Client> {
  const rows = await withUser(user.id, (tx) => tx<Client[]>`select id, name, slug, website, objective from public.clients where slug = ${slug}`);
  if (!rows[0]) notFound();
  return rows[0];
}

export async function clientRole(tx: Tx, clientId: string): Promise<"admin" | "account_lead" | "contributor" | null> {
  const r = await tx<{ role: string | null }[]>`select app.client_role(${clientId}) as role`;
  return (r[0]?.role as "admin" | "account_lead" | "contributor" | null) ?? null;
}

export const FACT_CATEGORIES: { key: string; label: string; sensitive: boolean }[] = [
  { key: "business_objective", label: "Business model and objective", sensitive: false },
  { key: "stakeholders", label: "Stakeholders and approvals", sensitive: false },
  { key: "products_launches", label: "Products and launches", sensitive: false },
  { key: "pricing_economics", label: "Pricing and economics", sensitive: true },
  { key: "customer_audience", label: "Customer and audience", sensitive: false },
  { key: "brand_voice", label: "Brand voice and positioning", sensitive: true },
  { key: "claims_compliance", label: "Approved claims and compliance", sensitive: true },
  { key: "offers_discounts", label: "Offers and discount rules", sensitive: true },
  { key: "platforms_access", label: "Platforms, access, integrations", sensitive: false },
  { key: "lists_segments_consent", label: "Lists, segments, consent", sensitive: false },
  { key: "constraints_rules", label: "Constraints and rules", sensitive: true },
  { key: "assets_references", label: "Assets and references", sensitive: false },
];

export const REBUILD_STATUSES = [
  "not_started",
  "documented",
  "redesign",
  "copy_ready",
  "internal_review",
  "client_approval",
  "built_draft",
  "live",
] as const;

export const QA_ITEMS = [
  "Links resolve",
  "Personalization fallbacks set",
  "Offer code valid and matches the approved offer",
  "Segment count sane and exclusions applied",
  "Mobile render checked",
  "Dark mode checked",
  "Legal footer present",
  "Unsubscribe link works",
  "Subject and preview reviewed",
  "Claims map to approved facts",
  "Design matches brief",
  "Send time matches calendar",
];

/** SOP 14 — design handoff ready check (from approved copy to a clear designer brief). */
export const HANDOFF_READY_ITEMS = [
  "Approved copy version named and frozen",
  "Every CTA has a destination URL on an approved domain",
  "Assets vetted and linked (no placeholder imagery)",
  "Mobile hierarchy and dark mode noted",
  "Owner and delivery date confirmed",
];
