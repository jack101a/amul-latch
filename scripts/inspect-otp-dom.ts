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

  const inputs = await page.locator("input").all();
  console.log(`Found ${inputs.length} inputs after Send OTP:`);
  for (const input of inputs) {
    const p = await input.getAttribute("placeholder");
    const t = await input.getAttribute("type");
    const vis = await input.isVisible();
    const val = await input.inputValue().catch(() => "");
    console.log(`input: type=${t} placeholder="${p}" visible=${vis} value="${val}"`);
  }

  const buttons = await page.locator("button").all();
  console.log(`Found ${buttons.length} buttons after Send OTP:`);
  for (const btn of buttons) {
    const txt = await btn.innerText();
    const vis = await btn.isVisible();
    if (txt.trim()) console.log(`button: "${txt.trim()}" visible=${vis}`);
  }

  await browser.close();
}

run().catch(console.error);
