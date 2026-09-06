import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });

  // Pre-seed pincode in localStorage or cookies
  await context.addCookies([
    { name: "pincode", value: "380001", domain: ".amul.com", path: "/" },
    { name: "city", value: "Ahmedabad", domain: ".amul.com", path: "/" }
  ]);

  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("pincode", "380001");
    localStorage.setItem("delivery_pincode", "380001");
  });

  console.log("Navigating to https://shop.amul.com/user/login with pre-seeded pincode...");
  await page.goto("https://shop.amul.com/user/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: "screenshots/login-with-preseeded-pincode.png" });
  console.log("Screenshot saved!");

  const pinModal = page.locator("text='Select Delivery Pincode'");
  console.log("Is pincode modal visible?", await pinModal.isVisible().catch(() => false));

  const phoneInput = page.locator("input[type='tel'], input[placeholder*='81234']").first();
  console.log("Is phone input visible?", await phoneInput.isVisible().catch(() => false));

  await browser.close();
}

run().catch(console.error);
