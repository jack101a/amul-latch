import { AmulClient } from "./client";
import { runCheckout } from "./checkout";
import { sendCallMeBot } from "./callmebot";
import {
  DEFAULT_CONFIG,
  type ActivityEvent,
  type AmulProduct,
  type AppConfig,
  type CheckoutAttempt,
  type EventKind,
  type EventLevel,
  type SubstoreInfo,
  type TrackedProduct,
  type WatchSnapshot,
  type WatchPhase,
  type UserProfileInfo,
  type SessionVerificationResult,
} from "./types";

type PreviousStock = Record<string, boolean>;
type CooldownMap = Record<string, number>;

type RuntimeState = {
  watching: boolean;
  config: AppConfig;
  client: AmulClient | null;
  substore: SubstoreInfo | null;
  products: AmulProduct[];
  events: ActivityEvent[];
  checkout: CheckoutAttempt | null;
  lastTickAt: number | null;
  nextPollMs: number;
  pollCount: number;
  lastError: string | null;
  amulReachable: boolean;
  sessionReady: boolean;
  userProfile: UserProfileInfo | null;
  previousStock: PreviousStock;
  primed: boolean;
  cooldowns: CooldownMap;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  sessionCookieUsed: string;
};

const g = globalThis as typeof globalThis & { __latchRuntime?: RuntimeState };

function loadPersistedConfig(): Partial<AppConfig> {
  try {
    if (typeof process !== "undefined" && process.cwd) {
      const fs = require("node:fs");
      const path = require("node:path");
      const file = path.resolve(process.cwd(), "latch-config.json");
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<AppConfig>;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

function savePersistedConfig(config: AppConfig) {
  try {
    if (typeof process !== "undefined" && process.cwd) {
      const fs = require("node:fs");
      const path = require("node:path");
      const file = path.resolve(process.cwd(), "latch-config.json");
      fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf-8");
    }
  } catch {
    /* ignore */
  }
}

function emptyState(): RuntimeState {
  const persisted = loadPersistedConfig();
  const initialConfig: AppConfig = {
    ...DEFAULT_CONFIG,
    ...persisted,
  };

  return {
    watching: false,
    config: initialConfig,
    client: null,
    substore: null,
    products: [],
    events: [],
    checkout: null,
    lastTickAt: null,
    nextPollMs: initialConfig.pollMinMs,
    pollCount: 0,
    lastError: null,
    amulReachable: true,
    sessionReady: false,
    userProfile: null,
    previousStock: {},
    primed: false,
    cooldowns: {},
    timer: null,
    inFlight: null,
    sessionCookieUsed: "",
  };
}

function state(): RuntimeState {
  if (!g.__latchRuntime) g.__latchRuntime = emptyState();
  return g.__latchRuntime;
}

export function getSnapshot(): WatchSnapshot {
  const s = state();
  return {
    phase: derivePhase(s),
    watching: s.watching,
    pincode: s.config.pincode,
    substore: s.substore,
    sessionReady: s.sessionReady,
    sessionImported: Boolean(s.config.sessionCookie.trim()) && Boolean(s.client?.imported),
    sessionLoggedIn: Boolean(s.client?.loggedIn || s.userProfile),
    userProfile: s.userProfile,
    lastTickAt: s.lastTickAt ? new Date(s.lastTickAt).toISOString() : null,
    nextPollMs: s.nextPollMs,
    pollCount: s.pollCount,
    products: s.products,
    tracked: s.config.products,
    autoOrder: s.config.autoOrder,
    events: s.events.slice(0, 80),
    checkout: s.checkout,
    lastError: s.lastError,
    amulReachable: s.amulReachable,
  };
}

export function setVerifiedProfile(cookie: string, profile: UserProfileInfo) {
  const s = state();
  s.userProfile = profile;
  s.sessionReady = true;
  s.sessionCookieUsed = cookie;
  s.config.sessionCookie = cookie;
  if (!s.client) {
    s.client = new AmulClient();
  }
  s.client.importCookies(cookie);
  s.client.loggedIn = true;
  s.client.imported = true;
  s.client.userId = profile.userId;
  s.client.userName = profile.userName;
  s.client.userPhone = profile.userPhone || "";
  s.client.userEmail = profile.userEmail || "";
  if (profile.defaultAddress) {
    s.client.fallbackAddress = profile.defaultAddress;
  }
  pushEvent(
    "session_ready",
    "ok",
    `Verified account: ${profile.userName}`,
    profile.defaultAddress ? `Default address: ${profile.defaultAddress.label}` : undefined,
  );
}

export function applyConfig(partial: Partial<AppConfig>) {
  const s = state();
  s.config = { ...s.config, ...partial };
  savePersistedConfig(s.config);
}

export async function fetchCatalog(pincode: string): Promise<{
  substore: SubstoreInfo;
  products: AmulProduct[];
}> {
  const s = state();
  const client = await ensureClient(pincode, s.config.sessionCookie);
  const substore =
    (client.substore && client.substore.pincode === pincode ? client.substore : null) ??
    (await client.setPincode(pincode));
  const products = await client.listProteinProducts();
  s.substore = substore;
  s.products = products;
  s.sessionReady = client.hasSession();
  s.amulReachable = true;
  s.lastError = null;
  if (!products.length) {
    pushEvent(
      "error",
      "warn",
      "Amul returned an empty protein catalog",
      "The shop answered but listed no SKUs — retry, or run Latch on a connection Amul accepts.",
    );
  }
  pushEvent("pincode_set", "ok", `${substore.name} · ${pincode}`, `Substore ${substore.slug}`);
  return { substore, products };
}

export async function startWatch(config: AppConfig) {
  const s = state();
  const same = s.watching && sameWatch(s.config, config);
  s.config = { ...DEFAULT_CONFIG, ...config };
  if (!same) {
    s.primed = false;
    s.previousStock = {};
  }
  s.watching = true;
  s.lastError = null;
  s.nextPollMs = s.config.pollMinMs;
  if (!same) {
    pushEvent(
      "watch_started",
      "ok",
      "Watcher started",
      `${config.products.length} SKU(s) · ${config.pincode}`,
    );
  }
  const stale = !s.lastTickAt || Date.now() - s.lastTickAt > s.nextPollMs;
  schedule(same && !stale ? s.nextPollMs : 0);
  return getSnapshot();
}

export function stopWatch() {
  const s = state();
  s.watching = false;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  pushEvent("watch_stopped", "info", "Watcher stopped");
  return getSnapshot();
}

export async function tickOnce(config?: Partial<AppConfig>): Promise<WatchSnapshot> {
  if (config) applyConfig(config);
  await runCycle(false);
  return getSnapshot();
}

export async function checkoutNow(sku: string): Promise<WatchSnapshot> {
  const s = state();
  const tracked = s.config.products.find((p) => p.sku === sku);
  if (!tracked) throw new Error("SKU is not in the watch list");
  await ensureClient(s.config.pincode, s.config.sessionCookie);
  await performCheckout(tracked, "manual");
  return getSnapshot();
}

export function clearCheckout() {
  state().checkout = null;
  return getSnapshot();
}

export function disconnectSession(): WatchSnapshot {
  const s = state();
  s.userProfile = null;
  s.sessionReady = false;
  s.sessionCookieUsed = "";
  s.config.sessionCookie = "";
  s.client = null;
  pushEvent("session_ready", "info", "Amul session disconnected");
  return getSnapshot();
}

export async function pingWhatsApp(phone: string, apiKey: string) {
  const result = await sendCallMeBot({
    phone,
    apiKey,
    text: "Latch WhatsApp alerts are connected! ⚡ You will get instant restock, checkout, and payment alerts here.",
  });
  if (result.ok) pushEvent("whatsapp", "ok", "WhatsApp test sent");
  else pushEvent("whatsapp", "error", "WhatsApp test failed", result.error);
  return result;
}

function schedule(ms: number) {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  if (!s.watching) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    void runCycle(true).finally(() => {
      if (s.watching) schedule(jitter(s.nextPollMs));
    });
  }, ms);
}

async function runCycle(force = false) {
  const s = state();
  if (s.inFlight) return s.inFlight;
  if (
    !force &&
    s.lastTickAt &&
    Date.now() - s.lastTickAt < Math.max(2500, s.nextPollMs * 0.45)
  ) {
    return;
  }
  s.inFlight = (async () => {
    try {
      await poll();
      s.nextPollMs = nextInterval(s);
      s.lastError = null;
      s.amulReachable = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Poll failed";
      s.lastError = message;
      s.amulReachable = !/fetch|network|timeout|HTML/i.test(message);
      s.nextPollMs = Math.min(s.config.pollMaxMs * 1.5, Math.max(s.nextPollMs * 2, 12000));
      s.sessionReady = false;
      if (/session expired|TID|401|403/i.test(message)) {
        s.client = null;
        pushEvent("session_expired", "warn", "Amul session expired — recovering");
        notify("Amul session expired. Latch is recovering it.");
      } else {
        pushEvent("error", "error", "Poll error", message);
      }
    } finally {
      s.lastTickAt = Date.now();
      s.pollCount += 1;
      s.inFlight = null;
    }
  })();
  return s.inFlight;
}

async function poll() {
  const s = state();
  if (!s.config.pincode) throw new Error("Set a pincode first");
  const client = await ensureClient(s.config.pincode, s.config.sessionCookie);
  if (!s.substore || s.substore.pincode !== s.config.pincode || s.pollCount % 20 === 0) {
    s.substore = await client.setPincode(s.config.pincode);
  }
  const products = await client.listProteinProducts();
  s.products = products;
  s.sessionReady = client.hasSession();

  if (!products.length) {
    pushEvent(
      "poll",
      "warn",
      "Empty catalog from Amul",
      "The shop answered but listed no protein SKUs. Backing off.",
    );
    s.nextPollMs = Math.min(s.config.pollMaxMs, Math.max(s.nextPollMs * 1.5, 15000));
    return;
  }

  const tracked = s.config.products;
  if (!tracked.length) {
    pushEvent("poll", "info", `Polled ${products.length} protein SKUs`);
    return;
  }

  const bySku = new Map(products.map((p) => [p.sku, p]));
  const restocks: AmulProduct[] = [];
  const already: AmulProduct[] = [];

  for (const item of tracked) {
    const live = bySku.get(item.sku);
    if (!live) {
      s.previousStock[item.sku] = false;
      continue;
    }
    const was = s.previousStock[item.sku];
    if (s.primed && was === false && live.inStock) restocks.push(live);
    if (live.inStock) already.push(live);
    s.previousStock[item.sku] = live.inStock;
  }

  if (!s.primed) {
    s.primed = true;
    const inCount = already.length;
    const outCount = tracked.length - inCount;
    pushEvent(
      "poll",
      "info",
      "Baseline captured",
      `${inCount} in stock · ${outCount} waiting`,
    );
    if (inCount) {
      notify(
        `Latch baseline for ${s.config.pincode}: ${already.map((p) => p.name).join(", ")} in stock. Auto-order waits for the next restock unless you checkout manually.`,
      );
    }
    if (s.config.orderIfAlreadyInStock && s.config.autoOrder) {
      for (const live of already) {
        const trackedItem = tracked.find((t) => t.sku === live.sku);
        if (trackedItem) await performCheckout(trackedItem, "already_in_stock");
      }
    }
    return;
  }

  if (restocks.length) {
    for (const live of restocks) {
      pushEvent("restock", "ok", "Restock detected", live.name, live.sku);
      notify(
        `🚨 RESTOCK: ${live.name}\n\nNow in stock for ${s.config.pincode}!\nPrice: ₹${live.price}\nShop: https://shop.amul.com/en/product/${live.alias}`,
      );
      const trackedItem = tracked.find((t) => t.sku === live.sku);
      if (trackedItem && s.config.autoOrder) {
        await performCheckout(trackedItem, "restock");
      }
    }
    return;
  }

  if (s.pollCount % 8 === 0) {
    const waiting = tracked.filter((t) => !bySku.get(t.sku)?.inStock);
    pushEvent(
      "poll",
      "info",
      `Still watching · ${waiting.length} out of stock`,
      s.substore ? s.substore.name : s.config.pincode,
    );
  }
}

async function performCheckout(
  product: TrackedProduct,
  reason: "restock" | "already_in_stock" | "manual",
) {
  const s = state();
  if (s.checkout?.status === "running") {
    pushEvent("checkout_started", "warn", "Checkout already running", product.sku, product.sku);
    return;
  }

  const now = Date.now();
  const until = s.cooldowns[product.sku] ?? 0;
  if (until > now && reason !== "manual") {
    pushEvent(
      "checkout_started",
      "warn",
      "Duplicate order blocked",
      `${product.sku} locked for ${Math.ceil((until - now) / 60000)} min`,
      product.sku,
    );
    return;
  }

  let resolved = product;
  if (s.client) {
    try {
      const liveList = await s.client.listProteinProducts();
      s.products = liveList;
      const live = liveList.find((p) => p.sku === product.sku);
      if (!live?.inStock) {
        s.checkout = {
          sku: product.sku,
          name: product.name,
          startedAt: new Date().toISOString(),
          status: "failed",
          message:
            reason === "manual"
              ? "SKU is not available for this pincode right now."
              : "SKU went out of stock before checkout finished.",
          shopUrl: `https://shop.amul.com/en/product/${product.alias}`,
        };
        pushEvent("order_failed", "warn", "Checkout aborted — not in stock", product.name, product.sku);
        return;
      }
      resolved = {
        ...product,
        productId: live.id,
        sellerId: live.sellerId ?? product.sellerId,
        name: live.name,
        alias: live.alias,
      };
    } catch {
      // Fall through with cached product ids.
    }
  }

  s.cooldowns[product.sku] = now + s.config.orderCooldownMs;
  s.checkout = {
    sku: resolved.sku,
    name: resolved.name,
    startedAt: new Date().toISOString(),
    status: "running",
    message: reason === "manual" ? "Manual checkout" : "Restock checkout",
    shopUrl: `https://shop.amul.com/en/product/${resolved.alias}`,
  };
  pushEvent("checkout_started", "ok", "Checkout started", resolved.name, resolved.sku);
  notify(`Checkout started: ${resolved.name} × ${resolved.quantity}`);

  if (!s.client) {
    s.checkout.status = "failed";
    s.checkout.message = "No Amul session";
    return;
  }

  const attempt = await runCheckout({ client: s.client, product: resolved });
  s.checkout = attempt;

  if (attempt.status === "awaiting_payment") {
    pushEvent("payment_required", "warn", "Payment approval required", attempt.message, product.sku);
    notify(
      [
        `💳 Payment Required for ${product.name}`,
        ``,
        `Latch has reserved your items and locked the cart!`,
        attempt.paymentUrl
          ? `👉 Authorize Payment: ${attempt.paymentUrl}`
          : `👉 Open Cart on Amul: ${attempt.shopUrl || "https://shop.amul.com/en/cart"}`,
        ``,
        `Approve in your UPI / bank app. Latch never asks for PIN, OTP, or CVV.`,
      ].join("\n"),
    );
  } else if (attempt.status === "success") {
    pushEvent("order_success", "ok", "Order accepted", product.name, product.sku);
    notify(`Order accepted: ${product.name}`);
  } else if (attempt.status === "blocked") {
    const isAddress = attempt.message.toLowerCase().includes("address");
    const title = isAddress ? "Delivery address required on Amul" : "Action required on Amul";
    pushEvent("order_failed", "warn", title, attempt.message, product.sku);
    notify(`Paused: ${product.name}. ${attempt.message}`);
  } else {
    pushEvent("order_failed", "error", "Checkout failed", attempt.message, product.sku);
    notify(`Checkout failed for ${product.name}: ${attempt.message}`);
  }
}

async function ensureClient(pincode: string, sessionCookie: string): Promise<AmulClient> {
  const s = state();
  if (
    s.client?.hasSession() &&
    s.substore?.pincode === pincode &&
    s.sessionCookieUsed === sessionCookie
  ) {
    if (s.userProfile) {
      s.client.loggedIn = true;
      if (s.userProfile.defaultAddress) {
        s.client.fallbackAddress = s.userProfile.defaultAddress;
      }
    }
    return s.client;
  }
  const client = new AmulClient();
  // Hydrate client with verified profile if available for this session
  if (s.userProfile && (s.config.sessionCookie === sessionCookie || !sessionCookie)) {
    client.loggedIn = true;
    client.userId = s.userProfile.userId;
    client.userName = s.userProfile.userName;
    client.userPhone = s.userProfile.userPhone || "";
    client.userEmail = s.userProfile.userEmail || "";
    if (s.userProfile.defaultAddress) {
      client.fallbackAddress = s.userProfile.defaultAddress;
    }
  }
  await client.init(sessionCookie);
  if (pincode) {
    s.substore = await client.setPincode(pincode);
  }
  // Re-verify that userProfile is preserved in case refreshTid did not return user
  if (s.userProfile && (s.config.sessionCookie === sessionCookie || !sessionCookie)) {
    client.loggedIn = true;
    client.userId = s.userProfile.userId;
    client.userName = s.userProfile.userName;
    client.userPhone = s.userProfile.userPhone || "";
    client.userEmail = s.userProfile.userEmail || "";
    if (s.userProfile.defaultAddress) {
      client.fallbackAddress = s.userProfile.defaultAddress;
    }
  }
  s.client = client;
  s.sessionCookieUsed = sessionCookie;
  s.sessionReady = true;
  if (client.loggedIn && !s.userProfile) {
    const profile = await client.fetchUserProfile().catch(() => null);
    if (profile) s.userProfile = profile;
  }
  pushEvent(
    "session_ready",
    client.loggedIn || s.userProfile ? "ok" : client.imported ? "warn" : "info",
    client.loggedIn || s.userProfile
      ? `Logged-in Amul session · ${s.userProfile?.userName ?? client.userId}`
      : client.imported
        ? "Imported Amul session (guest)"
        : "Anonymous Amul session",
    s.userProfile?.defaultAddress?.label,
  );
  return client;
}

export async function checkSessionCookie(sessionCookie: string): Promise<SessionVerificationResult> {
  const cookie = sessionCookie.trim();
  if (!cookie) {
    const s = state();
    s.userProfile = null;
    s.sessionReady = false;
    s.sessionCookieUsed = "";
    s.config.sessionCookie = "";
    s.client = null;
    return {
      valid: false,
      loggedIn: false,
      message: "No cookie provided",
    };
  }

  if (cookie.includes("demo-verified-customer")) {
    const demoProfile: UserProfileInfo = {
      userId: "amul_usr_demo_4412",
      userName: "Rohan Patel",
      userEmail: "rohan.patel@example.com",
      userPhone: "+91 98765 43210",
      defaultAddress: {
        id: "addr_demo_1",
        label: "Flat 402, Shivalik Heights, CG Road, Navrangpura, Ahmedabad, Gujarat 380009",
        city: "Ahmedabad",
        zip: "380009",
        raw: { full_name: "Rohan Patel", address_line_1: "Flat 402, Shivalik Heights" },
      },
      addressCount: 2,
    };
    setVerifiedProfile(cookie, demoProfile);
    return {
      valid: true,
      loggedIn: true,
      profile: demoProfile,
      message: `Connected to ${demoProfile.userName} · ${demoProfile.defaultAddress?.label || "Saved address"}`,
    };
  }

  const client = new AmulClient();
  const res = await client.verifySession(cookie);
  const s = state();

  if (res.valid && res.loggedIn && res.profile) {
    setVerifiedProfile(cookie, res.profile);
  } else if (res.valid && !res.loggedIn) {
    if (!s.userProfile) {
      pushEvent("session_ready", "warn", "Guest session", res.message);
    }
  } else {
    s.userProfile = null;
    pushEvent("session_ready", "error", "Invalid session", res.message);
  }

  return res;
}

/**
 * Returns decimal hour in Indian Standard Time (IST, UTC+5:30).
 * e.g., 14:30 IST returns 14.5.
 */
export function getISTDecimalHour(date = new Date()): number {
  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  return (utcHour + 5 + (utcMinute + 30) / 60) % 24;
}

/**
 * Calculates adaptive polling interval based on watch state and circadian restock windows:
 * - Active checkout / payment: priority polling (~5s).
 * - In-stock with autoOrder: min interval (pollMinMs).
 * - All watched items out-of-stock:
 *   - Night Dormancy (23:00 to 06:30 IST): substores dormant, backs off to 45s-90s to conserve CPU/RAM/traffic.
 *   - Morning & Evening Restock Peaks (10:00-14:00 & 18:00-22:00 IST): high-priority restock syncs (~6s-8s).
 *   - Standard Daytime (06:30-10:00 & 14:00-18:00 & 22:00-23:00 IST): baseline cadence (~8s-15s).
 */
export function calculateAdaptiveInterval(s: RuntimeState, now = new Date()): number {
  const tracked = s.config.products;
  const anyIn = tracked.some((t) => s.products.find((p) => p.sku === t.sku)?.inStock);

  if (s.checkout?.status === "running") return Math.max(s.config.pollMinMs, 5000);
  if (anyIn && s.config.autoOrder) return s.config.pollMinMs;

  const allOut = tracked.length > 0 && tracked.every((t) => !s.products.find((p) => p.sku === t.sku)?.inStock);
  if (allOut) {
    const minMs = Math.max(500, s.config.pollMinMs);
    const maxMs = Math.max(minMs, s.config.pollMaxMs);
    const istHour = getISTDecimalHour(now);

    // Night Dormancy window: 23:00 to 06:30 IST
    if (istHour >= 23 || istHour < 6.5) {
      return Math.max(maxMs, 45000);
    }

    // Daytime Peak Restock windows: 10:00 - 14:00 & 18:00 - 22:00 IST
    if ((istHour >= 10 && istHour < 14) || (istHour >= 18 && istHour < 22)) {
      return minMs;
    }

    // Daytime standard window (06:30 - 10:00 & 14:00 - 18:00 & 22:00 - 23:00 IST)
    return Math.round((minMs + maxMs) / 2);
  }

  return s.config.pollMinMs;
}

function nextInterval(s: RuntimeState): number {
  return calculateAdaptiveInterval(s);
}

function jitter(ms: number): number {
  const delta = ms * 0.18;
  return Math.round(ms - delta + Math.random() * 2 * delta);
}

function sameWatch(a: AppConfig, b: AppConfig): boolean {
  if (a.pincode !== b.pincode) return false;
  if (a.autoOrder !== b.autoOrder) return false;
  if (a.products.length !== b.products.length) return false;
  const key = (p: TrackedProduct) => `${p.sku}:${p.quantity}`;
  const left = a.products.map(key).sort().join("|");
  const right = b.products.map(key).sort().join("|");
  return left === right;
}

function derivePhase(s: RuntimeState): WatchPhase {
  if (s.checkout?.status === "awaiting_payment") return "awaiting_payment";
  if (s.checkout?.status === "running") return "checkout";
  if (s.checkout?.status === "success") return "ordered";
  if (!s.watching) return s.lastError ? "error" : "idle";
  if (s.lastError && !s.amulReachable) return "error";
  if (s.config.products.some((t) => s.products.find((p) => p.sku === t.sku)?.inStock)) return "restock";
  return "watching";
}

function pushEvent(
  kind: EventKind,
  level: EventLevel,
  title: string,
  detail?: string,
  sku?: string,
) {
  const s = state();
  s.events.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind,
    level,
    title,
    detail,
    sku,
  });
  if (s.events.length > 200) s.events.length = 200;
}

function notify(text: string) {
  const s = state();
  if (s.config.whatsappEnabled && s.config.whatsappPhone && s.config.whatsappApiKey) {
    const plain = text.replace(/<[^>]+>/g, "");
    void sendCallMeBot({
      phone: s.config.whatsappPhone,
      apiKey: s.config.whatsappApiKey,
      text: plain,
    }).then((res) => {
      if (!res.ok) pushEvent("whatsapp", "error", "WhatsApp failed", res.error);
    });
  }
}
