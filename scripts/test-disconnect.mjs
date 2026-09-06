import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.PORT || 8082;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const SHOTS_DIR = join(process.cwd(), "screenshots");

mkdirSync(SHOTS_DIR, { recursive: true });

async function runTest() {
  console.log(`[Disconnect E2E] Connecting to ${BASE_URL}...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const consoleLogs = [];
  const errors = [];
  page.on("console", (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === "error") {
      console.error("[Browser Console Error]", msg.text());
    }
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
    console.error("[Browser Uncaught Error]", err.message);
  });

  try {
    console.log("[Step 1] Loading Dashboard...");
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Open Desk Settings using exact selector from test-live-user.mjs
    console.log("[Step 2] Opening Desk Settings...");
    const settingsBtn = page.locator("button[aria-label='Settings']");
    await settingsBtn.waitFor({ state: "visible", timeout: 5000 });
    await settingsBtn.click();

    const dialog = page.locator("role=dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    console.log("[Step 2] Settings dialog visible.");

    // Check if already logged in or needs login
    const disconnectBtn = dialog.locator("button:has-text('Disconnect')");
    const isAlreadyConnected = await disconnectBtn.isVisible();

    if (!isAlreadyConnected) {
      console.log("[Step 2b] Logging in first via Demo Phone OTP...");
      const phoneInput = dialog.locator("#amul-phone");
      await phoneInput.waitFor({ state: "visible" });
      await phoneInput.fill("9999999999");
      await page.waitForTimeout(500);

      const sendOtpBtn = dialog.locator("button:has-text('Send OTP')");
      await sendOtpBtn.click();

      const otpInput = dialog.locator("#amul-otp");
      await otpInput.waitFor({ state: "visible", timeout: 8000 });
      await otpInput.fill("123456");

      const verifyOtpBtn = dialog.locator("button:has-text('Verify & Connect')");
      await verifyOtpBtn.click();
      await page.waitForTimeout(2000);

      await disconnectBtn.waitFor({ state: "visible", timeout: 6000 });
    }

    console.log("[Step 3] Account is currently connected. Verifying details before disconnect...");
    const verifiedBadge = dialog.locator("span:has-text('Account Connected & Verified')");
    await verifiedBadge.waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ path: join(SHOTS_DIR, "disconnect-1-before.png") });
    console.log("✅ Verified account card is currently visible.");

    // Click Disconnect
    console.log("[Step 4] Clicking Disconnect button...");
    await disconnectBtn.click();
    await page.waitForTimeout(1000);

    // Verify it disconnected
    console.log("[Step 5] Checking that account card is removed and login options appear...");
    const phoneInputAfter = dialog.locator("#amul-phone");
    await phoneInputAfter.waitFor({ state: "visible", timeout: 5000 });
    console.log("✅ Phone input is back! Account card was removed.");
    await page.screenshot({ path: join(SHOTS_DIR, "disconnect-2-after-click.png") });

    // Crucial: Wait for 7 seconds to let 3 background polls (interval is 2.5s) execute!
    console.log("[Step 6] Waiting 7 seconds to confirm background status polling DOES NOT automatically re-log in...");
    await page.waitForTimeout(7000);

    // Verify it is STILL disconnected!
    const isReconnected = await dialog.locator("span:has-text('Account Connected & Verified')").isVisible();
    if (isReconnected) {
      throw new Error("FAILED: Account automatically re-logged in after background polling!");
    }
    console.log("✅ PASS: After 7s and multiple server polls, account remains completely disconnected!");
    await page.screenshot({ path: join(SHOTS_DIR, "disconnect-3-after-waiting-polls.png") });

    // Close modal and check sidebar
    console.log("[Step 7] Closing modal and checking sidebar stats...");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    const sidebarCustomerName = page.locator("aside").locator("p:has-text('Rohan Patel')");
    const sidebarHasName = await sidebarCustomerName.isVisible();
    if (sidebarHasName) {
      throw new Error("FAILED: Customer name 'Rohan Patel' still visible in sidebar after disconnect!");
    }
    console.log("✅ PASS: Sidebar no longer displays verified customer profile!");

    // Refresh page to verify persistence of disconnect
    console.log("[Step 8] Refreshing page to verify disconnect persists across reloads...");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const sidebarAfterReload = await page.locator("aside").locator("p:has-text('Rohan Patel')").isVisible();
    if (sidebarAfterReload) {
      throw new Error("FAILED: Customer name reappeared in sidebar after page reload!");
    }
    console.log("✅ PASS: Disconnect persisted cleanly across full page reload!");
    await page.screenshot({ path: join(SHOTS_DIR, "disconnect-4-after-reload.png") });

    console.log("\n==========================================");
    console.log("🎉 DISCONNECT REGRESSION TEST PASSED 100%!");
    console.log("==========================================\n");
  } catch (err) {
    console.error("[Disconnect Test Failure]", err);
    await page.screenshot({ path: join(SHOTS_DIR, "disconnect-error.png") });
    throw err;
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
