import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("screenshots", { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto("http://127.0.0.1:8082/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Click Bengaluru quick hub chip
  const bengaluruChip = page.locator('button:has-text("Bengaluru (560001)")').first();
  if (await bengaluruChip.isVisible()) {
    await bengaluruChip.click();
    await page.waitForTimeout(3500);
  }

  // Click "Best Value" filter button
  const bestValueBtn = page.locator('button:has-text("Best Value")').first();
  if (await bestValueBtn.isVisible()) {
    console.log("Clicking Best Value filter button...");
    await bestValueBtn.click();
    await page.waitForTimeout(1000);
  }

  // Take Desktop Catalog Screenshot with Best Value sorted
  await page.screenshot({ path: "screenshots/latch-best-value-sorted.png" });
  console.log("Captured Best Value screenshot: screenshots/latch-best-value-sorted.png");

  await browser.close();
  console.log("Done!");
}

main().catch((err) => {
  console.error("Smoke script error:", err);
  process.exit(1);
});
