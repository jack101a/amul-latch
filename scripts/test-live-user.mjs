import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.PORT || 8082;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const SHOTS_DIR = join(process.cwd(), "screenshots");

mkdirSync(SHOTS_DIR, { recursive: true });

async function runTest() {
  console.log(`[E2E] Connecting to ${BASE_URL}...`);
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
    // 1. Initial page load
    console.log("[E2E Step 1] Navigating to Home...");
    const res = await page.goto(BASE_URL, { waitUntil: "networkidle" });
    if (!res || res.status() !== 200) {
      throw new Error(`Failed to load page: HTTP ${res?.status()}`);
    }
    console.log(`[E2E Step 1] Page loaded: ${await page.title()}`);
    await page.screenshot({ path: join(SHOTS_DIR, "live-e2e-1-initial.png") });

    // 2. Resolve Pincode
    console.log("[E2E Step 2] Entering PIN code 380001 (Ahmedabad - Amul HQ)...");
    const pinInput = page.locator("#pincode");
    await pinInput.fill("380001");

    console.log("[E2E Step 2] Clicking Load button...");
    const loadBtn = page.locator("form button[type='submit']");
    await loadBtn.click();

    console.log("[E2E Step 2] Waiting for Amul substore and protein catalog...");
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(SHOTS_DIR, "live-e2e-2-pincode-loaded.png") });

    const productCards = page.locator("article");
    const count = await productCards.count();
    console.log(`[E2E Step 2] Number of protein product cards rendered: ${count}`);

    const images = page.locator("article img");
    const imgCount = await images.count();
    console.log(`[E2E Step 2] Number of product images rendered: ${imgCount}`);

    // 3. Watch an item
    if (count > 0) {
      console.log("[E2E Step 3] Clicking 'Watch' on first product...");
      const watchBtn = productCards.first().locator("button", { hasText: "Watch" });
      if (await watchBtn.isVisible()) {
        await watchBtn.click();
        await page.waitForTimeout(500);

        const plusBtn = productCards.first().locator("button[aria-label='Increase quantity']");
        if (await plusBtn.isVisible()) {
          await plusBtn.click();
          console.log("[E2E Step 3] Increased quantity to 2.");
        }
      }
    }

    // 4. Open Settings Dialog & Test New Automated Phone Login
    console.log("\n[E2E Step 4] Opening Settings Dialog...");
    const settingsBtn = page.locator("button[aria-label='Settings']");
    await settingsBtn.click();
    await page.waitForTimeout(1000);

    const dialog = page.locator("role=dialog");
    await dialog.waitFor({ state: "visible" });
    console.log("[E2E Step 4] Settings dialog visible.");

    // Check Phone OTP tab is visible and selected by default
    const otpTab = dialog.locator("button:has-text('Phone OTP (Auto)')");
    await otpTab.waitFor({ state: "visible" });
    console.log("[E2E Step 4] ✅ 'Phone OTP (Auto)' tab detected.");

    // 4a. Enter Phone Number & Request OTP
    console.log("[E2E Step 4a] Entering mobile number 9999999999...");
    const phoneInput = dialog.locator("#amul-phone");
    await phoneInput.waitFor({ state: "visible" });
    await phoneInput.fill("9999999999");
    await page.waitForTimeout(500);

    console.log("[E2E Step 4a] Clicking 'Send OTP'...");
    const sendOtpBtn = dialog.locator("button:has-text('Send OTP')");
    await sendOtpBtn.click();

    // 4b. Wait for OTP step
    console.log("[E2E Step 4b] Waiting for OTP input step...");
    const otpInput = dialog.locator("#amul-otp");
    await otpInput.waitFor({ state: "visible", timeout: 8000 });
    console.log("[E2E Step 4b] ✅ OTP input is visible!");
    await page.screenshot({ path: join(SHOTS_DIR, "live-e2e-4b-otp-sent.png") });

    // 4c. Submit OTP & Verify
    console.log("[E2E Step 4c] Entering OTP 123456...");
    await otpInput.fill("123456");
    await page.waitForTimeout(500);

    console.log("[E2E Step 4c] Clicking 'Verify & Connect'...");
    const verifyBtn = dialog.locator("button:has-text('Verify & Connect')");
    await verifyBtn.click();
    await page.waitForTimeout(2000);

    // 4d. Confirm Verified Account Details
    console.log("[E2E Step 4d] Checking verified account card...");
    const verifiedBadge = dialog.locator("span:has-text('Account Connected & Verified')");
    await verifiedBadge.waitFor({ state: "visible", timeout: 6000 });
    console.log("[E2E Step 4d] ✅ Confirmed 'Account Connected & Verified' badge!");

    const nameEl = dialog.locator("p:has-text('Rohan Patel')");
    await nameEl.waitFor({ state: "visible" });
    console.log("[E2E Step 4d] ✅ Confirmed Customer Name: 'Rohan Patel'");

    const phoneEl = dialog.locator("p:has-text('+91 98765 43210')");
    await phoneEl.waitFor({ state: "visible" });
    console.log("[E2E Step 4d] ✅ Confirmed Mobile: '+91 98765 43210'");

    const addrEl = dialog.locator("p:has-text('Shivalik Heights')");
    await addrEl.waitFor({ state: "visible" });
    console.log("[E2E Step 4d] ✅ Confirmed Default Delivery Address rendered!");

    await page.screenshot({ path: join(SHOTS_DIR, "live-e2e-4d-verified-profile.png") });

    // 5. Test 1-Click Sync Bookmarklet tab
    console.log("\n[E2E Step 5] Testing '1-Click Sync' bookmarklet tab...");
    const bookmarkletTab = dialog.locator("button:has-text('1-Click Sync')");
    if (await bookmarkletTab.isVisible()) {
      await bookmarkletTab.click();
      await page.waitForTimeout(500);
      const bookmarkletBtn = dialog.locator("a:has-text('Sync to Latch')");
      if (await bookmarkletBtn.isVisible()) {
        console.log("[E2E Step 5] ✅ 1-Click Sync bookmarklet button verified!");
      }
      await page.screenshot({ path: join(SHOTS_DIR, "live-e2e-5-bookmarklet-tab.png") });
    }

    // Close settings dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // 6. Verify Dashboard Sidebar reflects the verified account!
    console.log("\n[E2E Step 6] Verifying Dashboard Sidebar shows verified customer details...");
    const sidebarAccount = page.locator("aside").locator("p:has-text('Rohan Patel')");
    await sidebarAccount.waitFor({ state: "visible", timeout: 5000 });
    console.log("[E2E Step 6] ✅ Customer name 'Rohan Patel' verified in sidebar stats card!");
    await page.screenshot({ path: join(SHOTS_DIR, "live-e2e-6-sidebar-confirmed.png") });

    console.log("\n==========================================");
    console.log("🎉 ALL E2E AUTOMATED LOGIN TESTS PASSED!");
    console.log("- Page Title: " + (await page.title()));
    console.log("- Products Loaded: " + count);
    console.log("- Images Loaded: " + imgCount);
    console.log("- Phone OTP Auto-Login: 100% Verified");
    console.log("- Customer Identity & Address: Confirmed");
    console.log("- Browser Errors: " + errors.length);
    console.log("==========================================\n");

  } catch (err) {
    console.error("[E2E Failure]", err);
    await page.screenshot({ path: join(SHOTS_DIR, "live-e2e-error.png") });
    throw err;
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
