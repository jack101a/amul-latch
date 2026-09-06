import { AmulClient } from "../src/lib/amul/client.ts";

async function main() {
  console.log("=== 1. Testing Invalid / Fake Cookie ===");
  const clientFake = new AmulClient();
  const fakeResult = await clientFake.verifySession("invalid-garbage-cookie-123");
  console.log("Fake cookie result:", JSON.stringify(fakeResult, null, 2));

  console.log("\n=== 2. Fetching real fresh guest cookie from Amul ===");
  const res = await fetch("https://shop.amul.com/user/info.js", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    }
  });
  const cookieHeader = res.headers.get("set-cookie") || "";
  const match = cookieHeader.match(/jsessionid=([^;]+)/);
  const guestCookie = match ? match[1] : "";
  console.log("Extracted guest jsessionid:", guestCookie ? guestCookie.slice(0, 40) + "..." : "none");

  if (guestCookie) {
    console.log("\n=== 3. Testing Guest Session Verification ===");
    const clientGuest = new AmulClient();
    const guestResult = await clientGuest.verifySession(guestCookie);
    console.log("Guest verification result:", JSON.stringify(guestResult, null, 2));
  }
}

main().catch(console.error);
