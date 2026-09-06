import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("screenshots", { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto("http://127.0.0.1:8082/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Click Mumbai quick hub chip
  const mumbaiChip = page.locator('button:has-text("Mumbai (400001)")').first();
  if (await mumbaiChip.isVisible()) {
    console.log("Clicking Mumbai (400001) quick chip...");
    await mumbaiChip.click();
    await page.waitForTimeout(3500);
  }

  // Filter for Blueberry
  const searchInput = page.locator('input[placeholder*="Filter by name"]').first();
  if (await searchInput.isVisible()) {
    await searchInput.fill("Blueberry");
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: "screenshots/latch-mumbai-blueberry.png" });
  console.log("Captured Mumbai blueberry screenshot: screenshots/latch-mumbai-blueberry.png");

  await browser.close();
  console.log("Done!");
}

main().catch((err) => {
  console.error("Smoke script error:", err);
  process.exit(1);
});
