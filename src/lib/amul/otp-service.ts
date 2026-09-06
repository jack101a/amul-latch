import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { checkSessionCookie, setVerifiedProfile } from "./runtime";
import type { UserProfileInfo } from "./types";

type PendingLogin = {
  token: string;
  phone: string;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  createdAt: number;
  timer?: NodeJS.Timeout;
};

const pendingLogins = new Map<string, PendingLogin>();

function generateToken(): string {
  return "latch_auth_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function cleanPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  // If 12 digits starting with 91, extract the 10 digits
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  return digits;
}

export type RequestOtpResult = {
  ok: boolean;
  token: string;
  message: string;
};

export type VerifyOtpResult = {
  ok: boolean;
  sessionCookie: string;
  profile?: UserProfileInfo | null;
  message: string;
};

export async function requestAmulOtp(rawPhone: string): Promise<RequestOtpResult> {
  const phone = cleanPhone(rawPhone);
  if (!phone || phone.length < 10) {
    throw new Error("Please enter a valid 10-digit mobile number");
  }

  // Demo fallback for instant testing without SMS
  if (phone === "9999999999" || rawPhone.toLowerCase().includes("demo")) {
    const demoToken = "demo_token_" + Date.now();
    pendingLogins.set(demoToken, {
      token: demoToken,
      phone,
      createdAt: Date.now(),
    });
    return {
      ok: true,
      token: demoToken,
      message: "OTP sent to your phone (Demo mode: use 123456)",
    };
  }

  const token = generateToken();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    // Pre-seed pincode to prevent "Select Delivery Pincode" modal from blocking login
    await context.addCookies([
      { name: "pincode", value: "380001", domain: ".amul.com", path: "/" },
      { name: "city", value: "Ahmedabad", domain: ".amul.com", path: "/" },
    ]);

    const page = await context.newPage();
    await page.addInitScript(() => {
      try {
        localStorage.setItem("pincode", "380001");
      } catch {
        // ignore
      }
    });

    await page.goto("https://shop.amul.com/user/login", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Dismiss any location modal that intercepts events
    await page.evaluate(() => {
      document.querySelectorAll("#locationWidgetModal, .modal-backdrop").forEach((el) => el.remove());
      document.body.classList.remove("modal-open");
    });

    const phoneInput = page.locator("input[type='tel'], input[placeholder*='81234']").first();
    await phoneInput.waitFor({ state: "visible", timeout: 8000 });
    await phoneInput.fill(phone);

    const sendOtpBtn = page.locator("button:has-text('Send OTP')").first();
    await sendOtpBtn.waitFor({ state: "visible", timeout: 5000 });
    await sendOtpBtn.click();

    // Wait for the OTP input to appear
    const otpInput = page.locator("input[placeholder*='Enter OTP'], input[placeholder*='OTP'], input[type='password']").first();
    await otpInput.waitFor({ state: "visible", timeout: 10000 });

    // Auto-expire session after 4 minutes if user abandons
    const timer = setTimeout(() => {
      cleanupPending(token);
    }, 4 * 60 * 1000);

    pendingLogins.set(token, {
      token,
      phone,
      browser,
      context,
      page,
      createdAt: Date.now(),
      timer,
    });

    return {
      ok: true,
      token,
      message: `OTP sent to +91 ${phone}. Please check your SMS.`,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => undefined);
    throw new Error(err instanceof Error ? err.message : "Failed to initiate Amul OTP");
  }
}

export async function verifyAmulOtp(token: string, rawOtp: string): Promise<VerifyOtpResult> {
  const otp = rawOtp.trim();
  if (!otp || otp.length < 4) {
    throw new Error("Please enter a valid OTP code");
  }

  // Handle demo mode
  if (token.startsWith("demo_token_") || otp === "123456") {
    cleanupPending(token);
    const demoCookie = "demo-verified-customer-rohan-patel";
    const verification = await checkSessionCookie(demoCookie);
    return {
      ok: true,
      sessionCookie: demoCookie,
      profile: verification.profile,
      message: `Verified: ${verification.profile?.userName || "Rohan Patel"} · Connected!`,
    };
  }

  const pending = pendingLogins.get(token);
  if (!pending || !pending.page || !pending.context) {
    throw new Error("Login session expired or not found. Please request a new OTP.");
  }

  try {
    const { page, context } = pending;
    const otpInput = page.locator("input[placeholder*='Enter OTP'], input[placeholder*='OTP'], input[type='password']").first();
    await otpInput.waitFor({ state: "visible", timeout: 8000 });
    await otpInput.fill(otp);
    await page.waitForTimeout(400);

    // Amul's "Sign in" trigger is an <a class="btn ..."> anchor tag, not a form submit button
    const signInBtn = page.locator("a:has-text('Sign in'), a.btn-primary:has-text('Sign in'), button:has-text('Sign in'), button[type='submit']").first();
    if (await signInBtn.isVisible()) {
      await signInBtn.click();
    } else {
      await otpInput.press("Enter");
    }

    await page.waitForTimeout(4000);

    // Check for error notice
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (
      bodyText.includes("Failed to verify OTP") ||
      bodyText.includes("Invalid OTP") ||
      bodyText.includes("Incorrect OTP") ||
      bodyText.includes("OTP Expired")
    ) {
      throw new Error("Invalid or expired OTP code. Please check the SMS and try again.");
    }

    // Extract cookies from authenticated browser
    const cookies = await context.cookies();
    const jsession = cookies.find((c) => c.name.toLowerCase() === "jsessionid");

    let cookieVal = jsession?.value;
    if (!cookieVal) {
      try {
        const rawDocCookie = await page.evaluate(() => document.cookie);
        const m = rawDocCookie.match(/jsessionid=([^;]+)/i);
        if (m) cookieVal = m[1];
      } catch {}
    }

    if (!cookieVal) {
      const anySession = cookies.find((c) => /session/i.test(c.name));
      if (anySession) cookieVal = anySession.value;
    }

    if (!cookieVal) {
      throw new Error("Login submitted, but session cookie was not set. Please retry.");
    }

    // Extract user profile and address from browser runtime if available
    let browserProfile: UserProfileInfo | null = null;
    try {
      browserProfile = await page.evaluate(async (phoneNum) => {
        const w = window as any;
        const u = w.session?.user || w.ms?.user || w.user || {};

        let addresses: any[] = [];
        try {
          const res = await fetch("/api/1/entity/ms.user_addresses?limit=10", {
            headers: { accept: "application/json", frontend: "1" },
          });
          if (res.ok) {
            const data = await res.json();
            addresses = data?.data || data?.records || (Array.isArray(data) ? data : []);
          }
        } catch {}

        const defaultAddr =
          addresses.find((a: any) => a.is_default || a.isDefault || a.default) || addresses[0] || null;

        let name = String(u.name || [u.first_name, u.last_name].filter(Boolean).join(" ") || "");
        let phone = String(u.phone || u.mobile || "");
        let email = String(u.email || "");

        if (defaultAddr) {
          if (!name) name = String(defaultAddr.full_name || defaultAddr.name || "");
          if (!phone) phone = String(defaultAddr.phone || defaultAddr.mobile || defaultAddr.contact || "");
          if (!email) email = String(defaultAddr.email || "");
        }

        if (!name) name = "Amul Customer";
        if (!phone && phoneNum) phone = `+91 ${phoneNum}`;

        let mappedAddress = null;
        if (defaultAddr) {
          const fullName = String(defaultAddr.full_name || defaultAddr.name || "");
          const city = String(defaultAddr.city || "");
          const zip = String(defaultAddr.zip || defaultAddr.pincode || "");
          const line = String(defaultAddr.address || defaultAddr.address1 || "");
          const label = [fullName, line, city, zip].filter(Boolean).join(" · ") || "Saved address";
          mappedAddress = {
            id: String(defaultAddr._id || ""),
            label,
            city: city || undefined,
            zip: zip || undefined,
            raw: defaultAddr,
          };
        }

        return {
          userId: String(u._id || u.id || `amul_${phoneNum || "user"}`),
          userName: name,
          userPhone: phone || undefined,
          userEmail: email || undefined,
          defaultAddress: mappedAddress,
          addressCount: addresses.length,
        };
      }, pending.phone);
    } catch {}

    cleanupPending(token);

    // Verify session & extract profile details directly
    const verifyResult = await checkSessionCookie(cookieVal);
    const profile: UserProfileInfo = (verifyResult.valid && verifyResult.profile)
      ? {
          ...verifyResult.profile,
          userName: (browserProfile?.userName && browserProfile.userName !== "Amul Customer")
            ? browserProfile.userName
            : verifyResult.profile.userName,
          userPhone: browserProfile?.userPhone || verifyResult.profile.userPhone,
          defaultAddress: verifyResult.profile.defaultAddress || browserProfile?.defaultAddress,
        }
      : browserProfile || {
          userId: `amul_${pending.phone}`,
          userName: "Amul Customer",
          userPhone: `+91 ${pending.phone}`,
          defaultAddress: null,
          addressCount: 0,
        };

    setVerifiedProfile(cookieVal, profile);

    return {
      ok: true,
      sessionCookie: cookieVal,
      profile,
      message: `Verified: ${profile.userName} · Connected!`,
    };
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Failed to verify OTP");
  }
}

function cleanupPending(token: string) {
  const item = pendingLogins.get(token);
  if (!item) return;
  if (item.timer) clearTimeout(item.timer);
  if (item.browser) {
    item.browser.close().catch(() => undefined);
  }
  pendingLogins.delete(token);
}
