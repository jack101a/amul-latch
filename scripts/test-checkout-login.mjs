import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.PORT || 8082;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const SHOTS_DIR = "/home/ubuntu/projects/grok/screenshots";

mkdirSync(SHOTS_DIR, { recursive: true });

async function run() {
  console.log(`Connecting to ${BASE_URL}...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.text().includes("Amul")) {
      console.log("[Console]", msg.text());
    }
  });
  page.on("pageerror", (err) => console.log("[PageError]", err.message));

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    console.log("Page loaded.");

    // Load pincode 380001
    const pinInput = page.locator("#pincode");
    await pinInput.fill("380001");
    const loadBtn = page.locator("form button[type='submit']");
    await loadBtn.click();
    console.log("Submitted pincode 380001.");
    await page.waitForTimeout(5000);

    // Open Settings dialog
    const settingsBtn = page.locator("button[aria-label='Settings']");
    await settingsBtn.click();
    await page.waitForTimeout(1000);

    // Switch to Phone OTP tab if not already active
    const otpTab = page.locator("button:has-text('Phone OTP')").first();
    await otpTab.click();
    await page.waitForTimeout(500);

    // Enter demo phone and click Send OTP
    const phoneInput = page.locator("#amul-phone");
    await phoneInput.fill("9999999999");
    const sendOtpBtn = page.locator("button:has-text('Send OTP')").first();
    await sendOtpBtn.click();
    await page.waitForTimeout(1000);

    // Enter demo OTP 123456
    const otpInput = page.locator("#amul-otp");
    await otpInput.fill("123456");
    const verifyBtn = page.locator("button:has-text('Verify & Connect')").first();
    await verifyBtn.click();
    await page.waitForTimeout(2500);

    // Close settings dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // Check that profile is displayed
    const bodyText = await page.locator("body").innerText();
    console.log("Profile check:", bodyText.includes("Rohan Patel") ? "Rohan Patel connected!" : "Not found");

    // Wait for product cards
    console.log("Waiting for product cards...");
    const firstCard = page.locator("article").first();
    await firstCard.waitFor({ state: "visible", timeout: 15000 });

    // Click Watch on first product
    const watchBtn = page.locator("article button:has-text('Watch')").first();
    if (await watchBtn.count() > 0) {
      console.log("Clicking Watch on first card...");
      await watchBtn.click();
      await page.waitForTimeout(1000);

      // Now click Checkout now
      const checkoutBtn = page.locator("button:has-text('Checkout now')").first();
      if (await checkoutBtn.count() > 0) {
        console.log("Clicking Checkout now button...");
        await checkoutBtn.click();
        await page.waitForTimeout(3000);

        await page.screenshot({ path: join(SHOTS_DIR, "checkout-logged-in-result.png") });
        const bannerText = await page.locator("body").innerText();

        const falsePause = bannerText.includes("Paused for Amul login");
        console.log("False 'Paused for Amul login' present?", falsePause);
        if (falsePause) {
          throw new Error("FAIL: Still showing 'Paused for Amul login' when user is logged in!");
        }

        console.log("SUCCESS: 'Paused for Amul login' was not shown! Banner message rendered correctly.");
      } else {
        console.log("Product is not in stock at this pin, but Watch was clicked.");
      }
    } else {
      console.log("No product cards found.");
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
