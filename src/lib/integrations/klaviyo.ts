import "server-only";

/** Minimal read-only Klaviyo client (public API, revision 2025-07-15). No write methods exist here on purpose. */
const BASE = "https://a.klaviyo.com/api";
const REVISION = "2025-07-15";

export type KlaviyoFlow = { id: string; name: string; status: string; trigger_type: string | null; archived: boolean; updated: string };
export type ReportRow = { groupings: Record<string, string>; statistics: Record<string, number | null> };
export type Timeframe = { key: "last_7_days" | "last_30_days" | "last_90_days" | "last_month" | "this_month" };

export class KlaviyoClient {
  constructor(private apiKey: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Klaviyo-API-Key ${this.apiKey}`,
        revision: REVISION,
        accept: "application/vnd.api+json",
        "content-type": "application/vnd.api+json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Klaviyo ${res.status} on ${path}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  async account(): Promise<{ id: string; organization_name: string }> {
    const r = await this.req<{ data: { id: string; attributes: { contact_information: { organization_name: string } } }[] }>("/accounts");
    return { id: r.data[0].id, organization_name: r.data[0].attributes.contact_information.organization_name };
  }

  async flows(): Promise<KlaviyoFlow[]> {
    const out: KlaviyoFlow[] = [];
    let url: string | null = `/flows?fields[flow]=name,status,trigger_type,archived,updated&page[size]=50`;
    while (url) {
      const r: { data: { id: string; attributes: Omit<KlaviyoFlow, "id"> }[]; links?: { next?: string | null } } = await this.req(url);
      out.push(...r.data.map((d) => ({ id: d.id, ...d.attributes })));
      url = r.links?.next ? r.links.next.replace(BASE, "") : null;
    }
    return out;
  }

  async flowActions(flowId: string): Promise<{ id: string; action_type: string; settings: unknown }[]> {
    const r = await this.req<{ data: { id: string; attributes: { action_type: string; settings: unknown } }[] }>(`/flows/${flowId}/flow-actions`);
    return r.data.map((d) => ({ id: d.id, ...d.attributes }));
  }

  async placedOrderMetricId(): Promise<string | null> {
    const r = await this.req<{ data: { id: string; attributes: { name: string; integration?: { name?: string } } }[] }>(`/metrics?fields[metric]=name,integration`);
    const shopify = r.data.find((m) => m.attributes.name === "Placed Order" && m.attributes.integration?.name === "Shopify");
    return (shopify ?? r.data.find((m) => m.attributes.name === "Placed Order"))?.id ?? null;
  }

  private async valuesReport(kind: "flow" | "campaign", timeframe: Timeframe, conversionMetricId: string): Promise<ReportRow[]> {
    const statistics = [
      "recipients", "delivered", "delivery_rate", "opens_unique", "open_rate", "clicks_unique", "click_rate",
      "bounce_rate", "spam_complaint_rate", "unsubscribe_rate", "conversions", "conversion_rate", "conversion_value", "revenue_per_recipient",
    ];
    const body = {
      data: {
        type: `${kind}-values-report`,
        attributes: { timeframe, conversion_metric_id: conversionMetricId, statistics },
      },
    };
    const r = await this.req<{ data: { attributes: { results: ReportRow[] } } }>(`/${kind}-values-reports`, { method: "POST", body: JSON.stringify(body) });
    return r.data.attributes.results;
  }

  flowReport(timeframe: Timeframe, metricId: string) { return this.valuesReport("flow", timeframe, metricId); }
  campaignReport(timeframe: Timeframe, metricId: string) { return this.valuesReport("campaign", timeframe, metricId); }

  async campaigns(channel: "email" | "sms") {
    const r = await this.req<{ data: { id: string; attributes: { name: string; status: string; send_time: string | null } }[] }>(
      `/campaigns?filter=equals(messages.channel,'${channel}')&fields[campaign]=name,status,send_time&sort=-send_time`);
    return r.data.map((d) => ({ id: d.id, ...d.attributes }));
  }
}
