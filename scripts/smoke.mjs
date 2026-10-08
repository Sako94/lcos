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
check("facts page lists 44 facts", factsBefore === 44, `(${factsBefore})`);
await shot(page, "03-facts");
// verify a proposed product fact as Drew
const debo = page.locator("li.py-3", { hasText: "Debo (debloat powder)" });
await debo.getByRole("button", { name: "verify" }).click();
await page.waitForTimeout(800);
check("drew verified a product fact", await debo.getByText("verified", { exact: true }).first().isVisible());
// approve an offers fact as Drew should fail with the DB message
const offer = page.locator("li.py-3", { hasText: "percent-off framing" });
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
  const li = page.locator("li.py-3", { hasText: text });
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

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
