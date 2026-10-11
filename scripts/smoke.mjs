// End-to-end smoke test against a running dev/prod server with AUTH_MODE=dev and a seeded DB.
// Usage: node scripts/smoke.mjs [baseUrl]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const shots = process.env.SHOTS ?? "";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); };

async function loginAs(ctx, name) {
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL(`${base}/`);
  return page;
}
async function shot(page, name) { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); }

// --- Drew (account lead) ---
let ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
let page = await loginAs(ctx, "Drew");
check("drew lands on home", await page.getByRole("heading", { name: "Agency home" }).isVisible());
await shot(page, "01-home-drew");

await page.goto(`${base}/clients/atrakt`);
check("client overview shows integrations", await page.getByText("Integration status").isVisible());
check("overview shows Klaviyo connected", (await page.locator("td", { hasText: /^klaviyo$/i }).count()) === 1);
await shot(page, "02-client-overview");

await page.goto(`${base}/clients/atrakt/facts`);
const factsBefore = await page.locator("li.py-3").count();
check("facts page lists 64 facts", factsBefore === 64, `(${factsBefore})`);
await shot(page, "03-facts");
// verify a proposed product fact as Drew
const factLi = (text) => page.locator("li.py-3", { has: page.locator("p.text-sm", { hasText: text }) });
const debo = factLi("Debo (debloat powder)");
await debo.getByRole("button", { name: "verify" }).click();
await page.waitForTimeout(800);
check("drew verified a product fact", await debo.getByText("verified", { exact: true }).first().isVisible());
// approve an offers fact as Drew should fail with the DB message
const offer = factLi("percent-off framing");
const approveBtn = offer.getByRole("button", { name: "approve" });
check("drew sees no approve button on a sensitive fact", (await approveBtn.count()) === 0);

await page.goto(`${base}/clients/atrakt/audit`);
check("audit shows weighted score", await page.getByText("/100 weighted").isVisible());
check("audit lists 7 findings", (await page.locator("li.py-3").count()) === 7);
await shot(page, "04-audit");
// run health review without Klaviyo key -> failed run with clear error
await page.getByRole("button", { name: "Run health review now" }).click();
await page.waitForTimeout(2500);
await page.reload();
const noKey = await page.getByText(/Klaviyo API key for atrakt is not set/).first().isVisible().catch(() => false);
const ran = await page.getByText(/Last health review:/).first().isVisible().catch(() => false);
check("health review runs (or fails cleanly without a key)", noKey || ran);

await page.goto(`${base}/clients/atrakt/flows`);
check("flows page lists 9 flows", (await page.getByRole("heading", { level: 3 }).count()) === 9);
await shot(page, "05-flows");

await page.goto(`${base}/clients/atrakt/calendar`);
check("calendar shows the draft cycle", await page.getByText(/Cycle Oct 1[23], 2026/).isVisible());
await page.locator("summary", { hasText: "Add a slot" }).click();
await page.locator('input[name="send_on"]').fill("2026-10-15");
await page.locator('input[name="title"]').first().fill("Sleep gummy launch");
await page.getByRole("button", { name: "Add slot + brief" }).click();
await page.waitForTimeout(800);
check("slot + brief created", await page.getByRole("link", { name: "Sleep gummy launch" }).first().isVisible());
await shot(page, "06-calendar");
await page.getByRole("link", { name: "Sleep gummy launch" }).first().click();
await page.waitForURL(/\/briefs\//);
const briefUrl = page.url();
// agent draft should fail: no approved facts (facts only verified)
await page.getByRole("button", { name: "Agent: draft brief + copy" }).click();
await page.waitForTimeout(2500);
check("agent refuses to draft without approved facts", await page.getByText(/No Approved facts/).first().isVisible());
await shot(page, "07-brief");

// --- 0006 screens ---
await page.goto(`${base}/clients/atrakt/decisions`);
check("decisions page lists open decisions", (await page.locator("li.py-3").count()) >= 5);
await page.locator('textarea[name="statement"]').fill("Approve the SMS welcome owner");
await page.locator('input[name="unlocks"]').fill("SMS welcome build");
await page.getByRole("button", { name: "Open" }).click();
await page.getByText("Approve the SMS welcome owner").first().waitFor({ timeout: 5000 }).catch(() => {});
check("decision opened", await page.getByText("Approve the SMS welcome owner").first().isVisible());
await page.goto(`${base}/clients/atrakt/journeys`);
check("journeys page shows 7 stages seeded", (await page.getByText(/entry: /).count()) >= 7);
await page.goto(`${base}/clients/atrakt/experiments`);
await page.locator('input[name="name"]').first().fill("Day-35 refill touch");
await page.locator('textarea[name="hypothesis"]').fill("A day-35 usage email lifts second purchase");
await page.locator('input[name="control"]').fill("20% holdout");
await page.locator('select[name="primary_metric"]').selectOption("repeat_rate_60d");
await page.locator('input[name="readout_on"]').fill("2026-12-15");
await page.getByRole("button", { name: "Propose" }).click();
await page.waitForTimeout(800);
check("experiment proposed", await page.getByText("Day-35 refill touch").isVisible());
await page.goto(`${base}/clients/atrakt/strategy`);
check("strategy shows contact policy", await page.getByText("approved link domains").isVisible());
await page.goto(`${base}/playbook/metrics`);
check("metric dictionary lists definitions", (await page.locator("tbody tr").count()) >= 12);
await page.goto(`${base}/clients/atrakt/facts`);
check("facts show evidence class", (await page.getByText("stated", { exact: true }).count()) > 0);

await page.goto(`${base}/clients/atrakt/meetings`);
await page.locator('input[name="scheduled_at"]').fill("2026-10-20T10:00");
await page.getByRole("button", { name: "Add meeting" }).click();
await page.waitForTimeout(800);
await page.getByRole("link", { name: /Oct 20, 2026/ }).click();
await page.waitForURL(/\/meetings\//);
await page.locator('input[name="statement"]').last().fill("Send Figma + photo assets to Wavy");
await page.locator('select[name="owner_id"]').selectOption({ label: "Andrew (Drew) Lauchner" });
await page.locator('input[name="due_on"]').fill("2026-10-12");
await page.getByRole("button", { name: /Add commitment/ }).click();
await page.waitForTimeout(800);
check("commitment recorded with owner and date", await page.getByText("Send Figma + photo assets to Wavy").isVisible());
await page.getByRole("button", { name: "Agent: draft pre-read" }).click();
await page.waitForTimeout(2500);
check("agent drafted a pre-read", (await page.locator('textarea[name="pre_read"]').inputValue()).includes("Scorecard"));
await shot(page, "08-meeting");
await ctx.close();

// --- Sako (admin) approves facts and cycle ---
ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
page = await loginAs(ctx, "Sako");
await page.goto(`${base}/clients/atrakt/facts`);
for (const text of ["percent-off framing", "Debo (debloat powder)", "Core audience: male"]) {
  const li = page.locator("li.py-3", { has: page.locator("p.text-sm", { hasText: text }) });
  await li.getByRole("button", { name: "approve" }).click();
  await page.waitForTimeout(700);
}
check("sako approved 3 facts", (await page.locator("li.py-3").filter({ hasText: "Approved by Sako Waves" }).count()) === 3);
await page.goto(briefUrl);
await page.getByRole("button", { name: "Agent: draft brief + copy" }).click();
await page.waitForTimeout(3000);
check("agent drafted copy v1 from approved facts", await page.getByText(/^v1 ·/).first().isVisible());
await shot(page, "09-brief-with-copy");
await page.goto(`${base}/clients/atrakt/calendar`);
await page.getByRole("button", { name: "Submit for approval" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Approve plan (admin)" }).click();
await page.waitForTimeout(600);
check("sako approved the cycle plan", await page.getByText("approved by Sako Waves").isVisible());
await page.goto(`${base}/agent`);
check("agent activity shows runs", (await page.locator("tbody tr").count()) >= 4);
await shot(page, "10-agent");
await page.goto(`${base}/playbook`);
check("playbook lists 22 SOPs", (await page.getByText(/^SOP \d+ ·/).count()) === 22);
await shot(page, "11-playbook");
await ctx.close();

// --- Andre (contributor) is limited ---
ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
page = await loginAs(ctx, "Andre Stock");
await page.goto(`${base}/clients/atrakt/facts`);
check("andre sees facts but no verify buttons", (await page.getByRole("button", { name: "verify" }).count()) === 0);
await page.goto(briefUrl);
check("andre cannot approve or draft", (await page.getByRole("button", { name: /Agent: draft/ }).count()) === 0);
await ctx.close();

// --- Onboarding questionnaire: Drew creates a link, the client fills it (no login), Drew reviews ---
ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
page = await loginAs(ctx, "Drew");
await page.goto(`${base}/clients/atrakt/onboarding`);
await page.locator('input[name="respondent_name"]').fill("Jamie Client");
await page.getByRole("button", { name: "Create link" }).click();
await page.waitForTimeout(800);
check("drew created an onboarding link", await page.getByRole("link", { name: "Jamie Client" }).isVisible());
await shot(page, "12-onboarding-links");
await page.getByRole("link", { name: "Jamie Client" }).click();
await page.waitForURL(/\/onboarding\/[0-9a-f-]{36}$/);
const reviewUrl = page.url();
const clientLink = await page.getByLabel("Client link").inputValue();
check("detail page shows the private client link", /\/onboard\/[0-9a-f]{48}$/.test(clientLink));

const cctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const cp = await cctx.newPage();
await cp.goto(clientLink);
check("client opens the form without logging in", await cp.getByRole("heading", { name: "Lifecycle onboarding" }).isVisible());
check("client sees no team sidebar", (await cp.getByText("Agent activity").count()) === 0);
await shot(cp, "13-client-form-section1");
const required = {
  brand_summary: "Clean gut-health gummies for busy men 25-40 who want to feel less bloated.",
  goals_90d: "1) Grow repeat revenue 2) Launch the sleep gummy 3) Rebuild the welcome series",
  customer_profiles: "Men 25-40, gym-goers, buy after a TikTok or podcast mention.",
  hero_products: "Debo (debloat powder) and the probiotic gummy; most first orders are Debo.",
  discount_limits: "Max 20% sitewide, never discount launches.",
  voice_is: "Direct, funny, confident",
  avoid_claims: "No disease claims, no 'cure', no competitor names.",
  primary_contact: "Jamie Client, Marketing lead, jamie@example.com",
  final_approver: "Jamie Client",
  success: "30: flows rebuilt; 60: email+SMS at 25% of revenue; 90: repeat rate up 5 points.",
};
const choices = { discount_stance: "Occasional promotions only", esp: "Klaviyo", sms_platform: "One Text" };
// walk every section, filling required answers
for (let i = 0; i < 8; i++) {
  for (const [k, v] of Object.entries(required)) {
    const el = cp.locator(`#q-${k}`);
    if (await el.count()) await el.fill(v);
  }
  for (const [, v] of Object.entries(choices)) {
    const b = cp.getByRole("radio", { name: v, exact: true });
    if (await b.count()) await b.click();
  }
  if (i === 3) await cp.getByRole("checkbox", { name: "Subscriptions" }).click();
  if (i === 3) await shot(cp, "14-client-form-offers");
  await cp.waitForTimeout(900);
  await cp.getByRole("button", { name: /Next section|Review answers/ }).click();
  await cp.waitForTimeout(400);
}
check("client reaches review with nothing required left", (await cp.getByText(/required question/).count()) === 0);
await cp.reload();
await cp.getByRole("button", { name: "1. Your business" }).click();
check("answers persist across a reload", (await cp.locator("#q-brand_summary").inputValue()).startsWith("Clean gut-health"));
await cp.getByRole("button", { name: "Review & submit" }).click();
await cp.locator("#submitter").fill("Jamie Client");
await shot(cp, "15-client-review");
await cp.getByRole("button", { name: "Submit to Wavy" }).click();
await cp.waitForTimeout(1500);
check("client sees the thank-you page", await cp.getByText("Thank you — we’ve got it").isVisible());
await shot(cp, "16-client-thanks");
await cp.goto(`${base}/onboard/${"0".repeat(48)}`);
check("unknown link shows not found", await cp.getByText("Link not found").isVisible());
await cctx.close();

await page.goto(reviewUrl);
check("submitted questionnaire shows answers to review", (await page.getByRole("button", { name: "Promote to Source of Truth" }).count()) >= 13);
const brand = page.locator('li[data-question="brand_summary"]');
await brand.getByRole("button", { name: "Promote to Source of Truth" }).click();
await page.waitForTimeout(900);
check("promoted answer links to a proposed fact", await brand.getByText("proposed", { exact: true }).isVisible());
const voice = page.locator('li[data-question="voice_is"]');
await voice.getByRole("button", { name: "Promote to Source of Truth" }).click();
await page.waitForTimeout(900);
await shot(page, "17-review");
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "skip all remaining" }).click();
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Mark reviewed" }).click();
await page.waitForTimeout(900);
check("questionnaire marked reviewed", await page.getByText(/reviewed by Andrew \(Drew\) Lauchner/).isVisible());
await page.goto(`${base}/clients/atrakt/facts?status=proposed`);
check("promoted fact cites the questionnaire source", await page.locator("li.py-3", { hasText: "Brand summary (client-stated)" }).getByText("Onboarding questionnaire — Jamie Client").isVisible());
await ctx.close();

ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
page = await loginAs(ctx, "Andre Stock");
await page.goto(`${base}/clients/atrakt/onboarding`);
check("contributor cannot create onboarding links", (await page.getByRole("button", { name: "Create link" }).count()) === 0);
await ctx.close();

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
