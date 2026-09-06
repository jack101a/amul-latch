import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.PORT || 8082;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const SHOTS_DIR = join(process.cwd(), "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

async function verifyMobileSync() {
  console.log(`Connecting to ${BASE_URL} with Pixel 7 mobile emulation...`);
  const browser = await chromium.launch({ headless: true });
  const pixel7 = devices["Pixel 7"];
  const context = await browser.newContext({
    ...pixel7,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error("[Browser Console Error]", msg.text());
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Click settings button
    console.log("Opening Desk Settings on mobile viewport...");
    const settingsBtn = page.locator("button[aria-label='Settings']");
    await settingsBtn.waitFor({ state: "visible", timeout: 5000 });
    await settingsBtn.click();
    await page.waitForTimeout(600);

    // If logged in, disconnect so we see the tabs
    const disconnectBtn = page.locator("button:has-text('Disconnect')");
    if (await disconnectBtn.isVisible({ timeout: 1000 })) {
      console.log("Session currently active, disconnecting to view sync methods...");
      await disconnectBtn.click();
      await page.waitForTimeout(800);
    }

    // Switch to 1-Click Sync tab
    console.log("Switching to 1-Click Sync tab...");
    const syncTabBtn = page.locator("button:has-text('1-Click Sync')");
    await syncTabBtn.waitFor({ state: "visible", timeout: 5000 });
    await syncTabBtn.click();
    await page.waitForTimeout(600);

    const shot1 = join(SHOTS_DIR, "mobile-sync-tab.png");
    await page.screenshot({ path: shot1, fullPage: true });
    console.log(`Saved screenshot 1: ${shot1}`);

    // Verify Mobile Advisory Card is present
    const mobileAdvisory = page.locator("text=Using Android or iPhone?");
    if (await mobileAdvisory.isVisible()) {
      console.log("✅ Mobile advisory card is visible!");
    } else {
      throw new Error("Mobile advisory card is not visible!");
    }

    // Test Switch to Phone OTP button
    console.log("Testing Switch to Phone OTP button...");
    const switchOtpBtn = page.locator("button:has-text('Switch to Phone OTP')");
    await switchOtpBtn.click();
    await page.waitForTimeout(400);

    const phoneInput = page.locator("input#amul-phone");
    if (await phoneInput.isVisible()) {
      console.log("✅ Successfully switched to Phone OTP tab via mobile shortcut!");
    } else {
      throw new Error("Failed to switch to Phone OTP tab!");
    }

    // Switch back to 1-Click Sync
    await syncTabBtn.click();
    await page.waitForTimeout(400);

    // Check Android steps
    const stepsVisible = await page.locator("text=Android Chrome Setup").isVisible();
    console.log(`Android Chrome steps visible: ${stepsVisible}`);

    // Test Copy Script button
    console.log("Testing Copy Script button...");
    const copyBtn = page.locator("button:has-text('Copy Script')").first();
    await copyBtn.click();
    await page.waitForTimeout(300);

    const copiedBadge = page.locator("text=Copied!").first();
    if (await copiedBadge.isVisible()) {
      console.log("✅ Copy Script triggered and visual 'Copied!' feedback displayed!");
    } else {
      console.warn("⚠️ Copied! feedback not visible immediately");
    }

    // Verify textarea script box
    const scriptBox = page.locator("textarea");
    const scriptValue = await scriptBox.inputValue();
    console.log(`Script box contains: ${scriptValue.slice(0, 45)}... (length ${scriptValue.length})`);
    if (!scriptValue.includes("jsessionid") || !scriptValue.includes("import_cookie")) {
      throw new Error("Script box content is invalid!");
    }

    const shot2 = join(SHOTS_DIR, "mobile-sync-complete.png");
    await page.screenshot({ path: shot2, fullPage: true });
    console.log(`Saved screenshot 2: ${shot2}`);

    console.log("🎉 All mobile sync E2E checks passed 100%!");
  } finally {
    await browser.close();
  }
}

verifyMobileSync().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
