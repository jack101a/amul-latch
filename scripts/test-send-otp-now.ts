import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });

  await context.addCookies([
    { name: "pincode", value: "380001", domain: ".amul.com", path: "/" },
    { name: "city", value: "Ahmedabad", domain: ".amul.com", path: "/" }
  ]);

  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("pincode", "380001");
  });

  console.log("Navigating to https://shop.amul.com/user/login...");
  await page.goto("https://shop.amul.com/user/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const phoneInput = page.locator("input[type='tel'], input[placeholder*='81234']").first();
  await phoneInput.fill("9876543210");
  console.log("Filled phone number 9876543210");

  const sendOtpBtn = page.locator("button:has-text('Send OTP')").first();
  console.log("Clicking Send OTP...");
  await sendOtpBtn.click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: "screenshots/after-send-otp-success.png" });
  console.log("Saved screenshots/after-send-otp-success.png");

  // Check what appeared on screen
  const text = await page.locator("body").innerText();
  console.log("Page text after send otp:\n" + text.slice(0, 500));

  await browser.close();
}

run().catch(console.error);
