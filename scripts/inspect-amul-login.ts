import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  await page.goto("https://shop.amul.com/login", { waitUntil: "networkidle" });
  
  // Fill pincode
  const pinInput = page.locator("input[placeholder*='Pincode'], input[placeholder*='PINCODE']");
  if (await pinInput.isVisible()) {
    await pinInput.fill("380001");
    await page.waitForTimeout(1000);
    const resultItem = page.locator("div, span, li, p").filter({ hasText: /^380001$/ }).first();
    if (await resultItem.isVisible()) {
      await resultItem.click();
      await page.waitForTimeout(2000);
    }
  }

  // Click Log In
  const loginLink = page.getByText("Log In", { exact: true }).first();
  if (await loginLink.isVisible()) {
    console.log("Clicking Log In link...");
    await loginLink.click();
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: "screenshots/login-modal-open.png" });
  console.log("Screenshot after clicking Log In saved.");

  const loginInputs = await page.locator("input").all();
  for (let i = 0; i < loginInputs.length; i++) {
    const p = await loginInputs[i].getAttribute("placeholder");
    const t = await loginInputs[i].getAttribute("type");
    const v = await loginInputs[i].isVisible();
    const id = await loginInputs[i].getAttribute("id");
    console.log(`Input #${i}: id=${id} type=${t} placeholder=${p} visible=${v}`);
  }

  await browser.close();
}

run().catch(console.error);
