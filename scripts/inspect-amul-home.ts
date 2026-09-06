import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  await page.goto("https://shop.amul.com/", { waitUntil: "networkidle" });
  
  // Fill pincode if popup appears
  const pinInput = page.locator("input[placeholder*='Pincode'], input[placeholder*='PINCODE']");
  if (await pinInput.isVisible()) {
    console.log("Pincode modal is visible, filling 380001...");
    await pinInput.fill("380001");
    await page.waitForTimeout(1000);
    const resultItem = page.locator("div, span, li, p").filter({ hasText: /^380001$/ }).first();
    if (await resultItem.isVisible()) {
      await resultItem.click();
      await page.waitForTimeout(2000);
    }
  }

  // Look for login buttons or links
  const loginElements = await page.locator("a, button").filter({ hasText: /log\s*in|sign\s*in/i }).all();
  console.log("Found login elements:", loginElements.length);
  for (let i = 0; i < loginElements.length; i++) {
    const text = await loginElements[i].innerText();
    const href = await loginElements[i].getAttribute("href");
    console.log(`Login element #${i}: text="${text.trim()}" href="${href}"`);
  }

  if (loginElements.length > 0) {
    console.log("Clicking first login element...");
    await loginElements[0].click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "screenshots/home-after-login-click.png" });
  }

  await browser.close();
}

run().catch(console.error);
