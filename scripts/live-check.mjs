// Live smoke test against the deployed app with Supabase sign-in.
// Usage: BASE=https://wavy-lcos.vercel.app EMAIL=... PASSWORD=... node scripts/live-check.mjs
import { chromium } from "playwright";

const base = process.env.BASE, email = process.env.EMAIL, password = process.env.PASSWORD;
if (!base || !email || !password) throw new Error("BASE, EMAIL, PASSWORD required");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const results = [];
const check = (n, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n} ${extra}`); };

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await page.click('button:has-text("Sign in")');
await page.waitForURL(`${base}/`, { timeout: 30000 });
check("signed in with Supabase", await page.getByRole("heading", { name: "Agency home" }).isVisible());
await page.goto(`${base}/clients/atrakt/facts`);
const n = await page.locator("li.py-3").count();
check("atrakt facts loaded", n === 64, `(${n})`);
await page.goto(`${base}/clients/atrakt/audit`);
check("audit page renders", await page.getByText("/100 weighted").isVisible());
if (process.env.RUN_HEALTH === "1") {
  await page.getByRole("button", { name: "Run health review now" }).click();
  await page.waitForTimeout(25000);
  await page.reload();
  const status = await page.locator("header, h1 ~ div, .text-sm").first().textContent().catch(() => "");
  const ok = await page.getByText(/Last health review:/).isVisible();
  check("health review ran", ok, status ?? "");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
}
await page.goto(`${base}/agent`);
check("agent activity renders", await page.getByRole("heading", { name: "Agent activity" }).isVisible());
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
