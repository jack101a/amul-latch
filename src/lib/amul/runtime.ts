import { AmulClient } from "./client";
import { runCheckout } from "./checkout";
import {
  sendTelegram,
  autoDetectTelegramChatId,
  fetchTelegramUpdates,
  answerCallbackQuery,
  type TelegramUpdate,
  type TelegramReplyMarkup,
} from "./telegram";
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
  const envBotToken = (typeof process !== "undefined" ? process.env.TELEGRAM_BOT_TOKEN : "") || "";
  const envChatId = (typeof process !== "undefined" ? process.env.TELEGRAM_CHAT_ID : "") || "";
  const initialConfig: AppConfig = {
    ...DEFAULT_CONFIG,
    ...persisted,
    ...(envBotToken ? { telegramBotToken: envBotToken, telegramEnabled: true } : {}),
    ...(envChatId ? { telegramChatId: envChatId } : {}),
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
  ensureTelegramPoller();
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
  ensureTelegramPoller();
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

export async function pingTelegram(botToken: string, chatId?: string) {
  const result = await sendTelegram({
    botToken,
    chatId,
    text: "Latch is connected. You will get restock, checkout, and payment alerts here. Latch never asks for UPI PIN, OTP, or CVV.",
  });
  if (result.ok) {
    applyConfig({
      telegramBotToken: botToken.trim(),
      telegramEnabled: true,
      ...(result.chatId ? { telegramChatId: result.chatId } : {}),
    });
    pushEvent("telegram", "ok", "Telegram test sent");
  } else {
    pushEvent("telegram", "error", "Telegram test failed", result.error);
  }
  return result;
}

export async function detectTelegramChat(botToken: string) {
  const result = await autoDetectTelegramChatId(botToken);
  if (result.ok && result.chatId) {
    applyConfig({
      telegramBotToken: botToken.trim(),
      telegramEnabled: true,
      telegramChatId: result.chatId,
    });
    pushEvent("telegram", "ok", `Auto-detected Telegram Chat ID: ${result.chatId}`);
  }
  return result;
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
        `🚨 <b>RESTOCK: ${live.name}</b>\n\nNow in stock for <b>${s.config.pincode}</b>!\nPrice: ₹${live.price}\n\nTap below to order immediately:`,
        {
          parseMode: "HTML",
          replyMarkup: {
            inline_keyboard: [
              [
                { text: "⚡ Instant Order (1x)", callback_data: `buy:${live.sku}` },
                { text: "🛒 Open Shop", url: `https://shop.amul.com/en/product/${live.alias}` },
              ],
            ],
          },
        },
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
        `💳 <b>Payment Required for ${product.name}</b>`,
        ``,
        `Latch has reserved your items and locked the cart!`,
        attempt.paymentUrl
          ? `👉 <a href="${attempt.paymentUrl}">Click here to Authorize Payment</a>`
          : `👉 <a href="${attempt.shopUrl}">Open Cart on Amul</a>`,
        ``,
        `<i>Approve in your UPI / bank app. Latch never asks for PIN, OTP, or CVV.</i>`,
      ].join("\n"),
      {
        parseMode: "HTML",
        replyMarkup: attempt.paymentUrl
          ? {
              inline_keyboard: [
                [{ text: "💳 Pay on Gateway", url: attempt.paymentUrl }],
                [{ text: "🛒 Open Amul Cart", url: attempt.shopUrl || "https://shop.amul.com/en/cart" }],
              ],
            }
          : undefined,
      },
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

function notify(
  text: string,
  options?: { replyMarkup?: TelegramReplyMarkup; parseMode?: "HTML" | "Markdown" },
) {
  const s = state();
  if (s.config.telegramEnabled && s.config.telegramBotToken && s.config.telegramChatId) {
    void sendTelegram({
      botToken: s.config.telegramBotToken,
      chatId: s.config.telegramChatId,
      text,
      replyMarkup: options?.replyMarkup,
      parseMode: options?.parseMode,
    }).then((res) => {
      if (!res.ok) pushEvent("telegram", "error", "Telegram failed", res.error);
    });
  }

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

// ==========================================
// Telegram Two-Way Interactive Bot Engine
// ==========================================

let tgPollingActive = false;
let tgPollingAbort: AbortController | null = null;
let lastTgUpdateId = 0;

export function ensureTelegramPoller() {
  const s = state();
  if (!s.config.telegramEnabled || !s.config.telegramBotToken) {
    stopTelegramPoller();
    return;
  }
  if (tgPollingActive) return;
  startTelegramPoller();
}

export function stopTelegramPoller() {
  if (tgPollingAbort) {
    tgPollingAbort.abort();
    tgPollingAbort = null;
  }
  tgPollingActive = false;
}

async function startTelegramPoller() {
  const s = state();
  if (tgPollingActive || !s.config.telegramEnabled || !s.config.telegramBotToken) return;
  tgPollingActive = true;
  const abortController = new AbortController();
  tgPollingAbort = abortController;
  console.log(`[Telegram Bot] Poller active for token ...${s.config.telegramBotToken.slice(-6)}`);

  void (async () => {
    while (tgPollingActive && !abortController.signal.aborted) {
      try {
        const token = s.config.telegramBotToken;
        if (!token) break;

        const res = await fetchTelegramUpdates({
          botToken: token,
          offset: lastTgUpdateId > 0 ? lastTgUpdateId + 1 : undefined,
          timeoutSeconds: 8,
        });

        if (!res.ok) {
          console.warn(`[Telegram Bot] Update fetch warning:`, res.error);
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        for (const update of res.updates) {
          lastTgUpdateId = Math.max(lastTgUpdateId, update.update_id);
          console.log(`[Telegram Bot] Processing update #${update.update_id}`);
          if (update.message) {
            await handleTelegramMessage(update.message);
          } else if (update.callback_query) {
            await handleTelegramCallback(update.callback_query);
          }
        }
      } catch (err) {
        console.error(`[Telegram Bot] Loop error:`, err);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    tgPollingActive = false;
    console.log(`[Telegram Bot] Poller stopped`);
  })();
}

async function handleTelegramMessage(msg: NonNullable<TelegramUpdate["message"]>) {
  const s = state();
  const token = s.config.telegramBotToken;
  if (!token) return;

  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();
  if (!text) return;

  // Security & Chat pairing
  if (!s.config.telegramChatId) {
    applyConfig({ telegramChatId: chatId });
    pushEvent("telegram", "ok", `Telegram chat auto-paired: ${chatId}`);
  } else if (s.config.telegramChatId !== chatId) {
    await sendTelegram({
      botToken: token,
      chatId,
      text: "⛔ <b>Access Denied</b>\nThis Latch bot instance is paired with another user.",
      parseMode: "HTML",
    });
    return;
  }

  const parts = text.split(/\s+/);
  const rawCmd = (parts[0] || "").toLowerCase().replace(/@\w+$/, "");
  const arg = parts.slice(1).join(" ").trim();

  if (rawCmd === "/start" || rawCmd === "/help") {
    const welcome = [
      "🥛 <b>Latch Amul Protein Bot</b>",
      "Your self-hosted Amul protein restock & auto-order assistant.",
      "",
      "<b>Commands:</b>",
      "• /status — Watcher state, account & live stats",
      "• /stock — Live in-stock protein items at your pincode",
      "• /pin <code> — Switch delivery pincode (e.g. <code>/pin 400068</code>)",
      "• /buy <sku> — Instantly order an in-stock item",
      "• /pause — Pause the background watcher",
      "• /resume — Resume background watching",
    ].join("\n");

    await sendTelegram({
      botToken: token,
      chatId,
      text: welcome,
      parseMode: "HTML",
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "📊 Check Status", callback_data: "cmd:status" },
            { text: "📦 View Stock", callback_data: "cmd:stock" },
          ],
          [
            { text: "▶️ Resume", callback_data: "cmd:resume" },
            { text: "⏸ Pause", callback_data: "cmd:pause" },
          ],
        ],
      },
    });
    return;
  }

  if (rawCmd === "/status") {
    await sendTelegramStatus(chatId);
    return;
  }

  if (rawCmd === "/stock") {
    await sendTelegramStock(chatId);
    return;
  }

  if (rawCmd === "/pin" || rawCmd === "/pincode") {
    const pin = arg.replace(/\D/g, "");
    if (!/^\d{6}$/.test(pin)) {
      await sendTelegram({
        botToken: token,
        chatId,
        text: "⚠️ Please provide a valid 6-digit pincode, e.g. <code>/pin 400068</code>",
        parseMode: "HTML",
      });
      return;
    }

    try {
      applyConfig({ pincode: pin });
      const cat = await fetchCatalog(pin);
      const inStockCount = cat.products.filter((p) => p.inStock).length;
      await sendTelegram({
        botToken: token,
        chatId,
        text: [
          `📍 <b>Delivery Pincode Updated: ${pin}</b>`,
          `Substore: <b>${cat.substore.name}</b>`,
          `Catalog: <b>${cat.products.length}</b> protein items (<b>${inStockCount}</b> in stock)`,
        ].join("\n"),
        parseMode: "HTML",
        replyMarkup: {
          inline_keyboard: [
            [{ text: "📦 View Live Stock", callback_data: "cmd:stock" }],
            [{ text: "📊 Status", callback_data: "cmd:status" }],
          ],
        },
      });
    } catch (err) {
      await sendTelegram({
        botToken: token,
        chatId,
        text: `❌ Failed to update pincode ${pin}: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
    return;
  }

  if (rawCmd.startsWith("/buy") || rawCmd === "/order") {
    let sku = "";
    if (rawCmd.startsWith("/buy_")) {
      sku = rawCmd.slice(5).trim();
    } else {
      sku = arg;
    }
    if (!sku) {
      await sendTelegram({
        botToken: token,
        chatId,
        text: "⚠️ Please specify a SKU, e.g. <code>/buy 54203</code> (send /stock to see available items)",
        parseMode: "HTML",
      });
      return;
    }
    await executeTelegramBuy(chatId, sku);
    return;
  }

  if (rawCmd === "/pause" || rawCmd === "/stop") {
    s.watching = false;
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    pushEvent("watch_started", "info", "Watcher paused via Telegram");
    await sendTelegram({
      botToken: token,
      chatId,
      text: "⏸ <b>Watcher Paused</b>\nBackground polling is paused. Send /resume or tap below to reactivate.",
      parseMode: "HTML",
      replyMarkup: {
        inline_keyboard: [[{ text: "▶️ Resume Watcher", callback_data: "cmd:resume" }]],
      },
    });
    return;
  }

  if (rawCmd === "/resume" || rawCmd === "/startwatch") {
    s.watching = true;
    schedule(0);
    pushEvent("watch_started", "ok", "Watcher resumed via Telegram");
    await sendTelegram({
      botToken: token,
      chatId,
      text: `▶️ <b>Watcher Resumed</b>\nMonitoring <b>${s.config.pincode || "configured pincode"}</b> for restocks.`,
      parseMode: "HTML",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "📊 Check Status", callback_data: "cmd:status" }],
          [{ text: "📦 View Stock", callback_data: "cmd:stock" }],
        ],
      },
    });
    return;
  }

  await sendTelegram({
    botToken: token,
    chatId,
    text: "Command not recognized. Send /help or /status to see available options.",
  });
}

async function sendTelegramStatus(chatId: string) {
  const s = state();
  const token = s.config.telegramBotToken;
  if (!token) return;

  const inStock = s.products.filter((p) => p.inStock).length;
  const watchingCount = s.config.products.length;
  const stateLabel = s.watching ? "Active 🟢" : "Paused ⏸";
  const userLabel = s.userProfile
    ? `${s.userProfile.userName} (${s.userProfile.userPhone || "Account linked"}) ✅`
    : "Guest (No Amul session linked) ⚠️";
  const modeLabel = s.config.autoOrder ? "Auto-Order Enabled ⚡" : "Notify Only 🔔";

  const msg = [
    "📊 <b>Latch Telemetry Status</b>",
    "",
    `• <b>State:</b> ${stateLabel}`,
    `• <b>Pincode:</b> ${s.config.pincode || "Not set"} (${s.substore?.name || "No hub"})`,
    `• <b>Account:</b> ${userLabel}`,
    `• <b>Mode:</b> ${modeLabel}`,
    `• <b>Watching:</b> ${watchingCount} SKU(s)`,
    `• <b>Live In-Stock:</b> ${inStock} items`,
    `• <b>Poll Interval:</b> ${Math.round(s.config.pollMinMs / 1000)}s – ${Math.round(s.config.pollMaxMs / 1000)}s`,
    `• <b>Total Polls:</b> ${s.pollCount}`,
  ].join("\n");

  await sendTelegram({
    botToken: token,
    chatId,
    text: msg,
    parseMode: "HTML",
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "🔄 Refresh Status", callback_data: "cmd:status" },
          { text: "📦 View Stock", callback_data: "cmd:stock" },
        ],
        [
          s.watching
            ? { text: "⏸ Pause Watcher", callback_data: "cmd:pause" }
            : { text: "▶️ Resume Watcher", callback_data: "cmd:resume" },
        ],
      ],
    },
  });
}

async function sendTelegramStock(chatId: string) {
  const s = state();
  const token = s.config.telegramBotToken;
  if (!token) return;

  if (!s.config.pincode) {
    await sendTelegram({
      botToken: token,
      chatId,
      text: "⚠️ Pincode is not set. Send e.g. <code>/pin 400068</code> first.",
      parseMode: "HTML",
    });
    return;
  }

  if (!s.products.length) {
    try {
      await fetchCatalog(s.config.pincode);
    } catch {
      // ignore
    }
  }

  const inStock = s.products.filter((p) => p.inStock);
  if (inStock.length === 0) {
    await sendTelegram({
      botToken: token,
      chatId,
      text: `📦 <b>Stock Status:</b> All protein items are currently <b>out of stock</b> for pincode <b>${s.config.pincode}</b> (${s.substore?.name || "Hub"}).\n\nLatch is watching and will alert you the second any item restocks!`,
      parseMode: "HTML",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "🔄 Check Again", callback_data: "cmd:stock" }],
          [{ text: "📊 Status", callback_data: "cmd:status" }],
        ],
      },
    });
    return;
  }

  const lines: string[] = [
    `📦 <b>Live In-Stock Protein (${inStock.length} items)</b>`,
    `Delivery Pincode: <b>${s.config.pincode}</b> (${s.substore?.name || "Hub"})`,
    "",
  ];

  const buttons: { text: string; callback_data: string }[][] = [];

  for (let i = 0; i < Math.min(inStock.length, 8); i++) {
    const p = inStock[i];
    const valuePart = p.costPerGramProtein ? ` · ₹${p.costPerGramProtein}/g` : "";
    lines.push(
      `<b>${i + 1}. ${p.name}</b>`,
      `💰 ₹${p.price}${valuePart} · /buy_${p.sku}`,
      "",
    );

    const shortName = p.name.length > 22 ? p.name.slice(0, 20) + "..." : p.name;
    buttons.push([{ text: `⚡ Buy ${shortName} (₹${p.price})`, callback_data: `buy:${p.sku}` }]);
  }

  buttons.push([
    { text: "🔄 Refresh Stock", callback_data: "cmd:stock" },
    { text: "📊 Status", callback_data: "cmd:status" },
  ]);

  await sendTelegram({
    botToken: token,
    chatId,
    text: lines.join("\n"),
    parseMode: "HTML",
    replyMarkup: { inline_keyboard: buttons },
  });
}

async function executeTelegramBuy(chatId: string, sku: string) {
  const s = state();
  const token = s.config.telegramBotToken;
  if (!token) return;

  const live = s.products.find((p) => p.sku === sku);
  const trackedItem = s.config.products.find((p) => p.sku === sku);

  if (!live && !trackedItem) {
    await sendTelegram({
      botToken: token,
      chatId,
      text: `⚠️ SKU <code>${sku}</code> was not found in the current catalog. Send /stock to see available items.`,
      parseMode: "HTML",
    });
    return;
  }

  const name = live?.name || trackedItem?.name || sku;
  const alias = live?.alias || trackedItem?.alias || "";
  const productId = live?.id || trackedItem?.productId || "";
  const sellerId = live?.sellerId || trackedItem?.sellerId || "";
  const inStock = live ? live.inStock : true;

  if (!inStock) {
    await sendTelegram({
      botToken: token,
      chatId,
      text: `⚠️ <b>${name}</b> is currently out of stock for ${s.config.pincode}. Latch will watch for restocks.`,
      parseMode: "HTML",
    });
    return;
  }

  if (!s.client || !s.sessionReady) {
    await sendTelegram({
      botToken: token,
      chatId,
      text: [
        `⚠️ <b>No Active Amul Session</b>`,
        `Cannot place order for <b>${name}</b> because you haven't linked your Amul account in Latch.`,
        ``,
        `👉 Please log in on the Latch web dashboard first (via OTP or Session Cookie).`,
      ].join("\n"),
      parseMode: "HTML",
    });
    return;
  }

  await sendTelegram({
    botToken: token,
    chatId,
    text: [
      `⚡ <b>Instant Checkout Triggered</b>`,
      `Product: <b>${name}</b>`,
      `Delivery Pincode: <b>${s.config.pincode}</b>`,
      ``,
      `Latch is locking the cart and preparing order on Amul...`,
    ].join("\n"),
    parseMode: "HTML",
  });

  try {
    const target: TrackedProduct = {
      sku,
      name,
      alias,
      productId,
      sellerId,
      quantity: 1,
    };
    await performCheckout(target, "manual");
  } catch (err) {
    await sendTelegram({
      botToken: token,
      chatId,
      text: `❌ Checkout error: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

async function handleTelegramCallback(cb: NonNullable<TelegramUpdate["callback_query"]>) {
  const s = state();
  const token = s.config.telegramBotToken;
  if (!token) return;

  const callbackQueryId = cb.id;
  const chatId = String(cb.message?.chat.id || "");
  const data = (cb.data || "").trim();

  if (s.config.telegramChatId && chatId !== s.config.telegramChatId) {
    await answerCallbackQuery({
      botToken: token,
      callbackQueryId,
      text: "Access denied",
      showAlert: true,
    });
    return;
  }

  if (data.startsWith("buy:")) {
    const sku = data.slice(4).trim();
    await answerCallbackQuery({
      botToken: token,
      callbackQueryId,
      text: "Starting instant checkout...",
    });
    await executeTelegramBuy(chatId, sku);
    return;
  }

  if (data === "cmd:status") {
    await answerCallbackQuery({ botToken: token, callbackQueryId, text: "Updating status..." });
    await sendTelegramStatus(chatId);
    return;
  }

  if (data === "cmd:stock") {
    await answerCallbackQuery({ botToken: token, callbackQueryId, text: "Fetching live stock..." });
    await sendTelegramStock(chatId);
    return;
  }

  if (data === "cmd:pause") {
    s.watching = false;
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    pushEvent("watch_started", "info", "Watcher paused via Telegram");
    await answerCallbackQuery({ botToken: token, callbackQueryId, text: "Watcher paused" });
    await sendTelegram({
      botToken: token,
      chatId,
      text: "⏸ <b>Watcher Paused</b>. Send /resume or tap below to reactivate.",
      parseMode: "HTML",
      replyMarkup: {
        inline_keyboard: [[{ text: "▶️ Resume Watcher", callback_data: "cmd:resume" }]],
      },
    });
    return;
  }

  if (data === "cmd:resume") {
    s.watching = true;
    schedule(0);
    pushEvent("watch_started", "ok", "Watcher resumed via Telegram");
    await answerCallbackQuery({ botToken: token, callbackQueryId, text: "Watcher resumed" });
    await sendTelegram({
      botToken: token,
      chatId,
      text: `▶️ <b>Watcher Resumed</b> for pincode <b>${s.config.pincode}</b>.`,
      parseMode: "HTML",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "📊 Check Status", callback_data: "cmd:status" }],
          [{ text: "📦 View Stock", callback_data: "cmd:stock" }],
        ],
      },
    });
    return;
  }

  await answerCallbackQuery({ botToken: token, callbackQueryId });
}

// Auto-start poller on module load if configured
if (typeof process !== "undefined") {
  setTimeout(() => ensureTelegramPoller(), 1000);
}
