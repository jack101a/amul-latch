import { AmulClient, type PromoBanner, type CouponValidationResult } from "./client";
import { sendCallMeBot } from "./callmebot";
import {
  sendDiscordWebhook,
  pingDiscord,
  sendPriceDropAlert,
  type DiscordEmbed,
} from "./discord";
import { renderProductCardPng } from "./card";
import {
  DEFAULT_CONFIG,
  productImageUrl,
  productPageUrl,
  formatProteinYield,
  calculateProteinCostPerGram,
  type ActivityEvent,
  type AmulProduct,
  type AppConfig,
  type EventKind,
  type EventLevel,
  type SubstoreInfo,
  type TrackedProduct,
  type WatchSnapshot,
  type WatchPhase,
} from "./types";

type PreviousStock = Record<string, boolean>;
type PreviousPrices = Record<string, number>;

type RuntimeState = {
  watching: boolean;
  config: AppConfig;
  client: AmulClient | null;
  substore: SubstoreInfo | null;
  products: AmulProduct[];
  events: ActivityEvent[];
  lastTickAt: number | null;
  nextPollMs: number;
  pollCount: number;
  lastError: string | null;
  amulReachable: boolean;
  sessionReady: boolean;
  previousStock: PreviousStock;
  previousPrices: PreviousPrices;
  primed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
};

const g = globalThis as typeof globalThis & { __latchRuntime?: RuntimeState };

function loadEnvConfig(): Partial<AppConfig> {
  if (typeof process === "undefined" || !process.env) return {};
  const env = process.env;
  const cfg: Partial<AppConfig> = {};
  if (env.PINCODE && env.PINCODE.trim()) {
    cfg.pincode = env.PINCODE.trim();
  }
  if (env.DISCORD_WEBHOOK_URL && env.DISCORD_WEBHOOK_URL.trim()) {
    cfg.discordWebhookUrl = env.DISCORD_WEBHOOK_URL.trim();
    cfg.discordEnabled =
      env.DISCORD_ENABLED === "true" ||
      env.DISCORD_ENABLED === "1" ||
      Boolean(cfg.discordWebhookUrl);
  } else if (env.DISCORD_ENABLED !== undefined) {
    cfg.discordEnabled = env.DISCORD_ENABLED === "true" || env.DISCORD_ENABLED === "1";
  }
  if (env.WHATSAPP_PHONE && env.WHATSAPP_PHONE.trim()) {
    cfg.whatsappPhone = env.WHATSAPP_PHONE.trim();
  }
  if (env.WHATSAPP_APIKEY && env.WHATSAPP_APIKEY.trim()) {
    cfg.whatsappApiKey = env.WHATSAPP_APIKEY.trim();
  }
  if (env.WHATSAPP_ENABLED !== undefined) {
    cfg.whatsappEnabled = env.WHATSAPP_ENABLED === "true" || env.WHATSAPP_ENABLED === "1";
  }
  return cfg;
}

function resolveConfigFile(): string | null {
  try {
    if (typeof process !== "undefined" && process.cwd) {
      const fs = require("node:fs");
      const path = require("node:path");
      const candidates = [
        path.resolve(process.cwd(), "data", "latch-config.json"),
        path.resolve(process.cwd(), "latch-config.json"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
      // If data directory exists (e.g. mounted volume in docker), prefer it
      const dataDir = path.resolve(process.cwd(), "data");
      if (fs.existsSync(dataDir)) {
        return path.join(dataDir, "latch-config.json");
      }
      return path.resolve(process.cwd(), "latch-config.json");
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface PersistedConfigData extends Partial<AppConfig> {
  previousPrices?: Record<string, number>;
}

function loadPersistedConfig(): {
  config: Partial<AppConfig>;
  previousPrices: Record<string, number>;
} {
  try {
    const file = resolveConfigFile();
    if (file) {
      const fs = require("node:fs");
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as PersistedConfigData &
          Record<string, unknown>;
        const {
          autoOrder: _autoOrder,
          orderIfAlreadyInStock: _orderIfAlreadyInStock,
          sessionCookie: _sessionCookie,
          previousPrices,
          ...rest
        } = parsed;
        const validPrices: Record<string, number> = {};
        if (
          previousPrices &&
          typeof previousPrices === "object" &&
          !Array.isArray(previousPrices)
        ) {
          for (const [k, v] of Object.entries(previousPrices)) {
            if (typeof v === "number" && Number.isFinite(v)) {
              validPrices[k] = v;
            }
          }
        }
        return {
          config: rest as Partial<AppConfig>,
          previousPrices: validPrices,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { config: {}, previousPrices: {} };
}

function savePersistedConfig(
  config: AppConfig,
  previousPrices?: Record<string, number>,
) {
  try {
    const file = resolveConfigFile();
    if (file) {
      const fs = require("node:fs");
      const pricesToSave = previousPrices ?? g.__latchRuntime?.previousPrices ?? {};
      const payload = {
        ...config,
        previousPrices: pricesToSave,
      };
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
    }
  } catch {
    /* ignore */
  }
}

function emptyState(): RuntimeState {
  const envConfig = loadEnvConfig();
  const { config: persistedConfig, previousPrices: persistedPrices } =
    loadPersistedConfig();
  const initialConfig: AppConfig = {
    ...DEFAULT_CONFIG,
    ...persistedConfig,
    ...envConfig,
  };

  // Environment variables take precedence if present
  if (envConfig.discordWebhookUrl) {
    initialConfig.discordWebhookUrl = envConfig.discordWebhookUrl;
    initialConfig.discordEnabled = envConfig.discordEnabled ?? true;
  }
  if (envConfig.pincode) {
    initialConfig.pincode = envConfig.pincode;
  }

  return {
    watching: false,
    config: initialConfig,
    client: null,
    substore: null,
    products: [],
    events: [],
    lastTickAt: null,
    nextPollMs: initialConfig.pollMinMs,
    pollCount: 0,
    lastError: null,
    amulReachable: true,
    sessionReady: false,
    previousStock: {},
    previousPrices: persistedPrices || {},
    primed: false,
    timer: null,
    inFlight: null,
  };
}

function state(): RuntimeState {
  if (!g.__latchRuntime) g.__latchRuntime = emptyState();
  return g.__latchRuntime;
}

export function getConfig(): AppConfig {
  return { ...state().config };
}

export function getSnapshot(): WatchSnapshot {
  const s = state();
  return {
    phase: derivePhase(s),
    watching: s.watching,
    pincode: s.config.pincode,
    config: s.config,
    substore: s.substore,
    sessionReady: s.sessionReady,
    lastTickAt: s.lastTickAt ? new Date(s.lastTickAt).toISOString() : null,
    nextPollMs: s.nextPollMs,
    pollCount: s.pollCount,
    products: s.products,
    tracked: s.config.products,
    events: s.events.slice(0, 80),
    lastError: s.lastError,
    amulReachable: s.amulReachable,
  };
}

export function applyConfig(partial: Partial<AppConfig>) {
  const s = state();
  const prevCount = s.config.products?.length || 0;
  s.config = { ...s.config, ...partial };
  savePersistedConfig(s.config, s.previousPrices);

  const newCount = s.config.products?.length || 0;
  // If we transitioned to 0 products while watching, enter periodic catalog sweep mode
  if (s.watching && newCount === 0 && prevCount > 0) {
    pushEvent(
      "watch_dormant",
      "info",
      "Catalog sweep mode",
      "Watchlist emptied — periodic sweep active for general discounts",
    );
    schedule(120000);
  } else if (s.watching && newCount > 0 && !s.timer && !s.inFlight) {
    // Products added to watchlist: wake up watcher immediately
    pushEvent("watch_resumed", "ok", "Watcher active", `Monitoring ${newCount} SKU(s)`);
    schedule(0);
  }
}

export async function fetchCatalog(pincode: string): Promise<{
  substore: SubstoreInfo;
  products: AmulProduct[];
}> {
  const s = state();
  // If previous catalog was empty or invalid, clear client to guarantee a fresh session
  if (!s.products.length) {
    s.client = null;
    s.sessionReady = false;
  }
  const client = await ensureClient(pincode);
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
    // Clear client so subsequent attempts do not reuse dead session
    s.client = null;
    s.sessionReady = false;
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

  if (!config.products.length) {
    pushEvent(
      "watch_started",
      "ok",
      "Catalog sweep started",
      `Monitoring general catalog discounts · ${config.pincode}`,
    );
    const stale = !s.lastTickAt || Date.now() - s.lastTickAt > s.nextPollMs;
    schedule(same && !stale ? s.nextPollMs : 0);
    return getSnapshot();
  }

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
  if (typeof (globalThis as unknown as { gc?: () => void }).gc === "function") {
    try { (globalThis as unknown as { gc: () => void }).gc(); } catch { /* ignore */ }
  }
  return getSnapshot();
}

export async function tickOnce(config?: Partial<AppConfig>): Promise<WatchSnapshot> {
  if (config) applyConfig(config);
  await runCycle(false);
  return getSnapshot();
}

export async function pingWhatsApp(phone: string, apiKey: string) {
  const result = await sendCallMeBot({
    phone,
    apiKey,
    text: "Latch WhatsApp alerts are connected! ⚡ You will get instant Amul restock alerts here.",
  });
  if (result.ok) pushEvent("whatsapp", "ok", "WhatsApp test sent");
  else pushEvent("whatsapp", "error", "WhatsApp test failed", result.error);
  return result;
}

export async function pingDiscordAlert(webhookUrl: string) {
  const result = await pingDiscord(webhookUrl);
  if (result.ok) pushEvent("discord", "ok", "Discord test sent");
  else pushEvent("discord", "error", "Discord test failed", result.error);
  return result;
}

function schedule(ms: number) {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  if (!s.watching) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    void runCycle(true).finally(() => {
      if (s.watching) {
        schedule(jitter(s.nextPollMs));
      }
    });
  }, ms);
}

async function runCycle(force = false) {
  const s = state();
  if (s.inFlight) return s.inFlight;
  if (!s.watching) {
    return;
  }
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
      s.sessionReady = true;
      pushEvent("error", "warn", "Amul catalog refresh retry", message);
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
  const client = await ensureClient(s.config.pincode);
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
      "The shop answered but listed no protein SKUs. Resetting session and backing off.",
    );
    s.client = null;
    s.sessionReady = false;
    s.nextPollMs = Math.min(s.config.pollMaxMs, Math.max(s.nextPollMs * 1.5, 15000));
    return;
  }

  const tracked = s.config.products || [];
  const trackedSkus = new Set(tracked.map((t) => t.sku));
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
    for (const p of products) {
      if (p.price > 0 && s.previousPrices[p.sku] === undefined) {
        s.previousPrices[p.sku] = p.price;
      }
    }
    savePersistedConfig(s.config, s.previousPrices);
    const inCount = already.length;
    const outCount = tracked.length - inCount;
    pushEvent(
      "poll",
      "info",
      "Baseline captured",
      tracked.length > 0
        ? `${inCount} in stock · ${outCount} waiting`
        : `Catalog sweep active · ${products.length} SKUs`,
    );
    if (inCount && tracked.length > 0) {
      notify(
        `Latch baseline for ${s.config.pincode}: ${already.map((p) => p.name).join(", ")} in stock. Watching for the next restock.`,
      );
    }
    return;
  }

  if (restocks.length) {
    for (const live of restocks) {
      pushEvent("restock", "ok", "Restock detected", live.name, live.sku);
      const shopUrl = live.productUrl || productPageUrl(live.alias);
      const imgUrl = productImageUrl(live.imageUrl);
      const stockUnits = live.inventoryQuantity || live.available || 1;
      const isWhey = /whey/i.test(live.name);
      const isShake = /shake|buttermilk|lassi|milk/i.test(live.name);
      const isPaneer = /paneer/i.test(live.name);
      const unitLabel = isWhey ? "boxes" : isShake ? "cases" : isPaneer ? "packs" : "units";
      const yieldStr = formatProteinYield(live.name, live.alias, live.proteinGrams);

      const descLines: string[] = [
        `## ₹${live.price.toLocaleString("en-IN")}  •  🟢 ${stockUnits} ${unitLabel}`,
        "",
      ];

      if (yieldStr) {
        descLines.push("-# PROTEIN & VALUE");
        if (live.costPerGramProtein) {
          descLines.push(`💪 **${yieldStr}**  •  ⚡ **₹${live.costPerGramProtein}/g**`);
        } else {
          descLines.push(`💪 **${yieldStr}**`);
        }
      } else if (live.costPerGramProtein) {
        descLines.push("-# VALUE");
        descLines.push(`⚡ **₹${live.costPerGramProtein}/g**`);
      }

      descLines.push("");
      descLines.push(`👉 [**⚡ Buy on Amul Store ↗**](${shopUrl})`);

      notify(
        `🚨 **RESTOCK ALERT:** **${live.name}** is now IN STOCK (${stockUnits} available) at **${s.config.pincode}**! 👉 ${shopUrl}`,
        {
          authorName: live.name,
          authorIconUrl: imgUrl,
          description: descLines.join("\n"),
          url: shopUrl,
          color: 0xffffff,
          imageUrl: imgUrl,
          footerText: "Latch Amul Radar • Non-Custodial Zero-Auth",
        },
      );
    }
  }

  let pricesChanged = false;

  for (const live of products) {
    const sku = live.sku;
    const currentPrice = live.price;
    if (!currentPrice || currentPrice <= 0) continue;

    const prevPrice = s.previousPrices[sku];
    const isWatched = trackedSkus.has(sku);
    const comparePrice = live.comparePrice;

    const hasPriceDrop =
      typeof prevPrice === "number" && prevPrice > 0 && currentPrice < prevPrice;

    const hasActiveDiscount =
      typeof comparePrice === "number" && comparePrice > currentPrice;

    if (hasPriceDrop) {
      const savingsAmount = prevPrice - currentPrice;
      const discountPct = Math.round((savingsAmount / prevPrice) * 100);
      const costPerGram =
        live.costPerGramProtein ?? calculateProteinCostPerGram(currentPrice, live.proteinGrams);

      pushEvent(
        "price_drop",
        "ok",
        `⚡ Price drop: ${live.name}`,
        `₹${prevPrice.toLocaleString("en-IN")} ➔ ₹${currentPrice.toLocaleString("en-IN")} (-${discountPct}% / Save ₹${savingsAmount.toLocaleString("en-IN")})${costPerGram ? ` • ₹${costPerGram}/g` : ""}`,
        sku,
      );

      if (s.config.discordEnabled && s.config.discordWebhookUrl) {
        if (isWatched || discountPct >= 5) {
          void sendPriceDropAlert({
            webhookUrl: s.config.discordWebhookUrl,
            product: live,
            oldPrice: prevPrice,
            newPrice: currentPrice,
            discountPct,
            savingsAmount,
            pincode: s.config.pincode,
            stockUnits: live.inventoryQuantity || live.available || (live.inStock ? 1 : 0),
          });
        }
      }
    } else if (hasActiveDiscount && (prevPrice === undefined || prevPrice > currentPrice)) {
      const savingsAmount = comparePrice - currentPrice;
      const discountPct = live.discountPct ?? Math.round((savingsAmount / comparePrice) * 100);
      const costPerGram =
        live.costPerGramProtein ?? calculateProteinCostPerGram(currentPrice, live.proteinGrams);

      pushEvent(
        "discount",
        "ok",
        `🏷️ Discount: ${live.name}`,
        `MRP ₹${comparePrice.toLocaleString("en-IN")} ➔ ₹${currentPrice.toLocaleString("en-IN")} (-${discountPct}% off / Save ₹${savingsAmount.toLocaleString("en-IN")})${costPerGram ? ` • ₹${costPerGram}/g` : ""}`,
        sku,
      );

      if (s.config.discordEnabled && s.config.discordWebhookUrl) {
        if (isWatched || discountPct >= 5) {
          void sendPriceDropAlert({
            webhookUrl: s.config.discordWebhookUrl,
            product: live,
            oldPrice: comparePrice,
            newPrice: currentPrice,
            discountPct,
            savingsAmount,
            pincode: s.config.pincode,
            stockUnits: live.inventoryQuantity || live.available || (live.inStock ? 1 : 0),
          });
        }
      }
    }

    if (s.previousPrices[sku] !== currentPrice) {
      s.previousPrices[sku] = currentPrice;
      pricesChanged = true;
    }
  }

  if (pricesChanged) {
    savePersistedConfig(s.config, s.previousPrices);
  }

  if (s.pollCount % 8 === 0) {
    if (tracked.length > 0) {
      const waiting = tracked.filter((t) => !bySku.get(t.sku)?.inStock);
      pushEvent(
        "poll",
        "info",
        `Still watching · ${waiting.length} out of stock`,
        s.substore ? s.substore.name : s.config.pincode,
      );
    } else {
      pushEvent(
        "poll",
        "info",
        `Catalog sweep · ${products.length} protein SKUs checked`,
        s.substore ? s.substore.name : s.config.pincode,
      );
    }
  }
}

async function ensureClient(pincode: string): Promise<AmulClient> {
  const s = state();
  if (s.client?.hasSession() && s.substore?.pincode === pincode) {
    return s.client;
  }
  const client = new AmulClient();
  await client.init();
  if (pincode) {
    s.substore = await client.setPincode(pincode);
  }
  s.client = client;
  s.sessionReady = true;
  return client;
}

export function productCategoryHeader(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("whey")) return "AMUL • WHEY PROTEIN";
  if (lower.includes("shake") || lower.includes("smoothie") || lower.includes("kool")) return "AMUL • PROTEIN SHAKE";
  if (lower.includes("buttermilk") || lower.includes("chaas") || lower.includes("lassi")) return "AMUL • HIGH PROTEIN BUTTERMILK";
  if (lower.includes("paneer")) return "AMUL • HIGH PROTEIN PANEER";
  return "AMUL • PROTEIN NUTRITION";
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
 * - In-stock watched SKUs: min interval (pollMinMs).
 * - All watched items out-of-stock:
 *   - Night Dormancy (23:00 to 06:30 IST): substores dormant, backs off to 45s-90s to conserve CPU/RAM/traffic.
 *   - Morning & Evening Restock Peaks (10:00-14:00 & 18:00-22:00 IST): high-priority restock syncs (~6s-8s).
 *   - Standard Daytime (06:30-10:00 & 14:00-18:00 & 22:00-23:00 IST): baseline cadence (~8s-15s).
 */
export function calculateAdaptiveInterval(s: RuntimeState, now = new Date()): number {
  const tracked = s.config.products || [];
  if (tracked.length === 0) {
    const istHour = getISTDecimalHour(now);
    // Night Dormancy (23:00 to 06:30 IST): 10 minutes sweep
    if (istHour >= 23 || istHour < 6.5) {
      return Math.min(s.config.pollMaxMs, 600000);
    }
    // Daytime sweep: every 2 minutes (120s)
    return Math.min(s.config.pollMaxMs, 120000);
  }

  const anyIn = tracked.some((t) => s.products.find((p) => p.sku === t.sku)?.inStock);

  if (anyIn) return s.config.pollMinMs;

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
  if (a.products.length !== b.products.length) return false;
  const key = (p: TrackedProduct) => `${p.sku}:${p.quantity}`;
  const left = a.products.map(key).sort().join("|");
  const right = b.products.map(key).sort().join("|");
  return left === right;
}

function derivePhase(s: RuntimeState): WatchPhase {
  if (!s.watching) return s.lastError ? "error" : "idle";
  if (s.lastError && !s.amulReachable) return "error";
  if (s.config.products?.some((t) => s.products.find((p) => p.sku === t.sku)?.inStock)) return "restock";
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

export interface NotificationMeta {
  authorName?: string;
  authorIconUrl?: string | null;
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  footerText?: string;
  cardImageBuffer?: Buffer;
}

function notify(text: string, meta?: NotificationMeta) {
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

  if (s.config.discordEnabled && s.config.discordWebhookUrl) {
    if (meta?.cardImageBuffer) {
      void sendDiscordWebhook({
        webhookUrl: s.config.discordWebhookUrl,
        username: "⚡ Latch Amul Radar",
        content: `### [⚡ Buy ${meta.title || "Now"} on Amul Store ↗](${meta.url || "https://shop.amul.com"})`,
        file: {
          buffer: meta.cardImageBuffer,
          filename: "amul-product-card.png",
        },
      }).then((res) => {
        if (!res.ok) pushEvent("discord", "error", "Discord webhook failed", res.error);
      });
    } else {
      const embed: DiscordEmbed = {
        author: meta?.authorName
          ? {
              name: meta.authorName,
              icon_url: meta.authorIconUrl || undefined,
              url: meta.url || undefined,
            }
          : undefined,
        title: meta?.title,
        description: meta?.description || (meta?.fields && meta.fields.length > 0 ? undefined : text),
        url: meta?.url,
        color: meta?.color ?? 0xffffff,
        fields: meta?.fields,
        thumbnail: meta?.thumbnailUrl ? { url: meta.thumbnailUrl } : undefined,
        image: meta?.imageUrl ? { url: meta.imageUrl } : undefined,
        footer: { text: meta?.footerText || "Latch Amul Radar • Non-Custodial Zero-Auth" },
        timestamp: new Date().toISOString(),
      };

      const components = meta?.url
        ? [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 5,
                  label: "⚡ Buy on Amul Store ↗",
                  url: meta.url,
                },
              ],
            },
          ]
        : undefined;

      void sendDiscordWebhook({
        webhookUrl: s.config.discordWebhookUrl,
        username: "⚡ Latch Amul Radar",
        embeds: [embed],
        components,
      }).then((res) => {
        if (!res.ok) pushEvent("discord", "error", "Discord webhook failed", res.error);
      });
    }
  }
}

export async function fetchPromoBanners(): Promise<PromoBanner[]> {
  const s = state();
  const client = await ensureClient(s.config.pincode || "400068");
  return client.listPromoBanners();
}

export async function validateCoupon(
  couponCode: string,
  cartId?: string,
): Promise<CouponValidationResult> {
  const s = state();
  const client = await ensureClient(s.config.pincode || "400068");
  return client.checkCoupon(couponCode, cartId);
}

