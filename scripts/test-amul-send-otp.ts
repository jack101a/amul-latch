import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  console.log("Navigating to https://shop.amul.com/user/login...");
  await page.goto("https://shop.amul.com/user/login", { waitUntil: "networkidle" });
  
  // Close pincode modal if open (press Escape or click outside or fill)
  const pinInput = page.locator("input[placeholder*='Pincode'], input[placeholder*='PINCODE']");
  if (await pinInput.isVisible()) {
    console.log("Filling pincode to clear modal...");
    await pinInput.fill("380001");
    await page.waitForTimeout(500);
    const resultItem = page.locator("div, span, li, p").filter({ hasText: /^380001$/ }).first();
    if (await resultItem.isVisible()) {
      await resultItem.click();
      await page.waitForTimeout(1500);
    }
  }

  // Find phone input
  const phoneInput = page.locator("input[type='tel'], input[placeholder*='81234']").first();
  await phoneInput.waitFor({ state: "visible", timeout: 5000 });
  console.log("Phone input visible, filling dummy number 9876543210...");
  await phoneInput.fill("9876543210");
  await page.waitForTimeout(500);

  // Click Send OTP
  const sendOtpBtn = page.locator("button:has-text('Send OTP')");
  console.log("Send OTP button visible:", await sendOtpBtn.isVisible());
  await sendOtpBtn.click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: "screenshots/after-send-otp-click.png" });
  console.log("Screenshot captured after Send OTP click.");

  // Check what inputs or messages appeared
  const bodyText = await page.locator("body").innerText();
  console.log("Page text snippet:", bodyText.slice(0, 300));

  const otpInput = page.locator("input[placeholder*='OTP'], input[name*='otp']");
  console.log("OTP input visible:", await otpInput.isVisible().catch(() => false));

  await browser.close();
}

run().catch(console.error);
