import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });
  await context.addCookies([{ name: "pincode", value: "380001", domain: ".amul.com", path: "/" }]);
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("pincode", "380001"));
  await page.goto("https://shop.amul.com/user/login", { waitUntil: "networkidle" });
  await page.locator("input[type='tel']").fill("9876543210");
  await page.locator("button:has-text('Send OTP')").click();
  await page.waitForTimeout(3000);

  const signinEl = page.locator("text='Sign in'");
  const count = await signinEl.count();
  console.log("Count of 'Sign in' elements:", count);
  for (let i = 0; i < count; i++) {
    const el = signinEl.nth(i);
    const tag = await el.evaluate(e => e.tagName);
    const cls = await el.getAttribute("class");
    const vis = await el.isVisible();
    console.log(`El #${i}: tag=${tag} class="${cls}" visible=${vis}`);
  }

  await browser.close();
}

run().catch(console.error);
