import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });
  await context.addCookies([{ name: "pincode", value: "380001", domain: ".amul.com", path: "/" }]);
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("pincode", "380001"));
  await page.goto("https://shop.amul.com/user/login", { waitUntil: "networkidle" });
  
  await page.locator("input[type='tel']").fill("9876543210");
  await page.locator("button:has-text('Send OTP')").click();
  await page.waitForTimeout(2500);

  const otpInput = page.locator("input[placeholder='Enter OTP'], input[type='password']").first();
  console.log("OTP Input visible:", await otpInput.isVisible());
  await otpInput.fill("123456");
  console.log("Filled OTP 123456, pressing Enter...");
  await otpInput.press("Enter");
  await page.waitForTimeout(2500);

  await page.screenshot({ path: "screenshots/otp-enter-pressed.png" });
  console.log("Screenshot after pressing Enter saved.");

  const pageText = await page.locator("body").innerText();
  console.log("Page text after submitting dummy OTP:", pageText.slice(0, 400));

  await browser.close();
}

run().catch(console.error);
