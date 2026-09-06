import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  await page.goto("http://127.0.0.1:8082/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const settingsBtn = page.locator('button[aria-label="Settings"], button:has-text("Settings"), button:has(svg.lucide-settings)').first();
  if (await settingsBtn.isVisible()) {
    await settingsBtn.click();
    await page.waitForTimeout(500);
    const dialogContent = page.locator('[role="dialog"]').first();
    await dialogContent.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(300);
    await page.screenshot({ path: "screenshots/latch-settings-flexible-time.png" });
    console.log("Captured updated flexible settings screenshot!");
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Smoke script error:", err);
  process.exit(1);
});
