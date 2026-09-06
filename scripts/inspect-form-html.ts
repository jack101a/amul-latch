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
  await page.waitForTimeout(3000);

  const otpInput = page.locator("input[placeholder='Enter OTP']");
  const container = otpInput.locator("xpath=./ancestor::div[contains(@class, 'container') or contains(@class, 'modal') or contains(@class, 'card') or contains(@class, 'login') or contains(@class, 'box') or contains(@class, 'row')][last()]");
  const html = await container.innerHTML().catch(async () => {
    return await otpInput.locator("xpath=../../..").innerHTML();
  });
  console.log("Container HTML:\n", html.slice(0, 1500));

  await browser.close();
}

run().catch(console.error);
