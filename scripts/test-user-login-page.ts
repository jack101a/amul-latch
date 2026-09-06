import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  console.log("Navigating to https://shop.amul.com/user/login...");
  await page.goto("https://shop.amul.com/user/login", { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/user-login-page.png" });

  const inputs = await page.locator("input").all();
  console.log(`Found ${inputs.length} inputs`);
  for (const input of inputs) {
    const p = await input.getAttribute("placeholder");
    const t = await input.getAttribute("type");
    const n = await input.getAttribute("name");
    const id = await input.getAttribute("id");
    const vis = await input.isVisible();
    console.log(`input: id=${id} name=${n} type=${t} placeholder="${p}" visible=${vis}`);
  }

  const buttons = await page.locator("button, a.btn").all();
  console.log(`Found ${buttons.length} buttons`);
  for (const btn of buttons) {
    const txt = await btn.innerText();
    const vis = await btn.isVisible();
    if (txt.trim()) console.log(`button: "${txt.trim()}" visible=${vis}`);
  }

  await browser.close();
}

run().catch(console.error);
