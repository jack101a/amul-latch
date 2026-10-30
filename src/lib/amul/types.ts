export const AMUL_ORIGIN = "https://shop.amul.com";
export const AMUL_STORE_ID = "62fa94df8c13af2e242eba16";
export const CALLMEBOT_ORIGIN = "https://api.callmebot.com";

export const EXTERNAL_DOMAINS = [
  {
    host: "shop.amul.com",
    why: "Official Amul shop — pincode routing and live stock",
  },
  {
    host: "api.callmebot.com",
    why: "CallMeBot API — WhatsApp alerts without requiring account access or QR scan",
  },
] as const;

export type StockState = "in_stock" | "out_of_stock" | "unknown";

export type WatchPhase =
  | "idle"
  | "watching"
  | "restock"
  | "checkout"
  | "awaiting_payment"
  | "ordered"
  | "error";

export type EventLevel = "info" | "ok" | "warn" | "error";

export type EventKind =
  | "watch_started"
  | "watch_stopped"
  | "watch_dormant"
  | "watch_resumed"
  | "session_ready"
  | "session_expired"
  | "pincode_set"
  | "poll"
  | "restock"
  | "price_drop"
  | "discount"
  | "checkout_started"
  | "cart_updated"
  | "payment_required"
  | "order_success"
  | "order_failed"
  | "whatsapp"
  | "discord"
  | "error";

export type TrackedProduct = {
  sku: string;
  quantity: number;
  name: string;
  alias: string;
  productId: string;
  sellerId?: string;
};

export type AppConfig = {
  pincode: string;
  products: TrackedProduct[];
  soundEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappPhone: string;
  whatsappApiKey: string;
  discordEnabled: boolean;
  discordWebhookUrl: string;
  pollMinMs: number;
  pollMaxMs: number;
  orderCooldownMs: number;
};

export type AmulProduct = {
  id: string;
  sku: string;
  name: string;
  alias: string;
  price: number;
  comparePrice?: number | null;
  discountAmount?: number | null;
  discountPct?: number | null;
  available: number;
  inventoryQuantity: number;
  inventoryLowStock: number;
  inStock: boolean;
  imageUrl: string | null;
  sellerId?: string;
  productUrl: string;
  proteinGrams?: number | null;
  costPerGramProtein?: number | null;
  proteinPerServing?: number | null;
  servingSizeText?: string | null;
};

export type SubstoreInfo = {
  pincode: string;
  slug: string;
  id: string;
  name: string;
};

export type SavedAddress = {
  id: string;
  label: string;
  city?: string;
  zip?: string;
  raw: Record<string, any>;
};

export type ActivityEvent = {
  id: string;
  at: string;
  kind: EventKind;
  level: EventLevel;
  title: string;
  detail?: string;
  sku?: string;
};

export type CheckoutAttempt = {
  sku: string;
  name: string;
  quantity?: number;
  price?: number;
  startedAt: string;
  status: "running" | "awaiting_payment" | "success" | "failed" | "blocked";
  message: string;
  paymentUrl?: string;
  cartId?: string;
  shopUrl?: string;
  recipientName?: string;
  recipientPhone?: string;
  addressSummary?: string;
  paymentMethodName?: string;
};

export type UserProfileInfo = {
  userId: string;
  userName: string;
  userEmail?: string;
  userPhone?: string;
  defaultAddress?: SavedAddress | null;
  addressCount: number;
};

export type SessionVerificationResult = {
  valid: boolean;
  loggedIn: boolean;
  profile?: UserProfileInfo | null;
  message: string;
};

export type WatchSnapshot = {
  phase: WatchPhase;
  watching: boolean;
  pincode: string;
  config?: AppConfig;
  substore: SubstoreInfo | null;
  sessionReady: boolean;
  userProfile?: UserProfileInfo | null;
  lastTickAt: string | null;
  nextPollMs: number;
  pollCount: number;
  products: AmulProduct[];
  tracked: TrackedProduct[];
  events: ActivityEvent[];
  lastError: string | null;
  amulReachable: boolean;
  previousPrices?: Record<string, number>;
};

export const DEFAULT_CONFIG: AppConfig = {
  pincode: "400068",
  products: [],
  soundEnabled: true,
  whatsappEnabled: false,
  whatsappPhone: "",
  whatsappApiKey: "",
  discordEnabled: false,
  discordWebhookUrl: "",
  pollMinMs: 6000,
  pollMaxMs: 40000,
  orderCooldownMs: 45 * 60 * 1000,
};

export function productImageUrl(image?: any): string | null {
  if (typeof image !== "string" || !image.trim()) return null;
  if (image.startsWith("http")) return image;
  const clean = image.replace(/^\//, "");
  if (clean.startsWith("s/")) return `${AMUL_ORIGIN}/${clean}`;
  return `${AMUL_ORIGIN}/s/${AMUL_STORE_ID}/${clean}`;
}

export function productPageUrl(alias?: string): string {
  if (!alias) return `${AMUL_ORIGIN}`;
  return `${AMUL_ORIGIN}/en/product/${alias}`;
}

export function isInStock(
  available: number,
  inventory: number,
  lowStock = 0,
  allowOutOfStock = false,
): boolean {
  if (allowOutOfStock) return true;
  if (available <= 0) return false;
  if (inventory <= 0) return false;
  if (lowStock > 0 && inventory < lowStock) return false;
  return true;
}

export function maskSecret(value?: any): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const v = value.trim();
  if (v.length <= 6) return v ? "••••" : "";
  return `${v.slice(0, 3)}…${v.slice(-3)}`;
}

export function extractPackMultiplier(name: string, alias?: string): number {
  const text = `${name || ""} ${alias || ""}`.toLowerCase();

  // 1. "pack of 30", "pack 8", "pack of 10", "pack of 8", "pack of 32"
  const packOfMatch = text.match(/\bpack\s*(?:of\s*)?(\d{1,3})\b/);
  if (packOfMatch) {
    const count = parseInt(packOfMatch[1], 10);
    if (count > 0 && count <= 200) return count;
  }

  // 2. "30 sachets", "10 sachets", "30 packs", "8 packs", "30 bottles", "30 cans"
  const unitsMatch = text.match(/\b(\d{1,3})\s*(?:sachets?|packs?|bottles?|tetra\s*packs?|cans?|units?)\b/);
  if (unitsMatch) {
    const count = parseInt(unitsMatch[1], 10);
    if (count > 0 && count <= 200) return count;
  }

  // 3. Multiplier format e.g. "30 x 200ml" or "10 x 34g"
  const multMatch = text.match(/\b(\d{1,2})\s*x\s*\d+/);
  if (multMatch) {
    const count = parseInt(multMatch[1], 10);
    if (count > 0 && count <= 200) return count;
  }

  return 1;
}

export function stripHtml(s?: any): string {
  if (typeof s !== "string" || !s) return "";
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "-")
    .replace(/&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NutritionInfo {
  proteinGrams: number | null;
  proteinPerServing: number | null;
  servingSizeText: string | null;
}

export function extractNutritionInfo(
  name: string,
  alias?: string,
  metafields?: Record<string, any> | null,
  description?: string | null,
): NutritionInfo {
  if (!name && !alias) {
    return { proteinGrams: null, proteinPerServing: null, servingSizeText: null };
  }

  const title = `${name || ""} ${alias || ""}`.toLowerCase();
  const cleanBenefits = stripHtml(metafields?.benefits);
  const cleanHowTo = stripHtml(metafields?.how_to_useit);
  const cleanDesc = stripHtml(description);
  const metaText = `${cleanBenefits} ${cleanHowTo} ${cleanDesc}`.toLowerCase();

  // Non-protein candidate check
  const isProtein =
    title.includes("protein") ||
    title.includes("whey") ||
    title.includes("chaas") ||
    title.includes("lassi") ||
    title.includes("buttermilk") ||
    title.includes("peanut spread") ||
    title.includes("peanut butter") ||
    metaText.includes("protein");

  if (!isProtein) {
    return { proteinGrams: null, proteinPerServing: null, servingSizeText: null };
  }

  const multiplier = extractPackMultiplier(name, alias);
  let baseGrams: number | null = null;
  let proteinPerServing: number | null = null;
  let servingSizeText: string | null = null;

  // Tier 1: Title-based Product Classification (Prevents Cross-Contamination)
  if (title.includes("wheat flour") || title.includes("atta")) {
    baseGrams = 20;
    proteinPerServing = 20;
    servingSizeText = "65g sachet";
  } else if (title.includes("cube") || title.includes("cubes")) {
    baseGrams = 125;
    proteinPerServing = 25;
    servingSizeText = "38g serving";
  } else if (title.includes("peanut spread") || (title.includes("peanut") && title.includes("spread"))) {
    baseGrams = 100;
    proteinPerServing = 10;
    servingSizeText = "25g serving";
  } else if (title.includes("peanut butter")) {
    const weightMatch = title.match(/\b(\d+(?:\.\d+)?)\s*(?:g|gm|gms)\b/);
    const weight = weightMatch ? parseFloat(weightMatch[1]) : 300;
    baseGrams = Number((weight * 0.26).toFixed(1));
    proteinPerServing = 8;
    servingSizeText = `${weight}g jar`;
  } else if (title.includes("paneer")) {
    baseGrams = 100;
    proteinPerServing = 25;
    servingSizeText = "400g tin";
  } else if (title.includes("whey")) {
    if (title.match(/\b24\s*(?:g|gm|gms|grams?)\b/)) {
      baseGrams = 24;
      proteinPerServing = 24;
    } else {
      baseGrams = 25;
      proteinPerServing = 25;
    }
    servingSizeText = "sachet";
  } else if (title.includes("buttermilk") || title.includes("chaas") || title.includes("chach")) {
    baseGrams = 15;
    proteinPerServing = 15;
    servingSizeText = "200 mL bottle";
  } else if (title.includes("kool") || title.includes("milkshake")) {
    baseGrams = 10;
    proteinPerServing = 10;
    servingSizeText = "180 mL pack";
  } else if (title.includes("shake")) {
    baseGrams = 20;
    proteinPerServing = 20;
    servingSizeText = "200 mL bottle";
  } else if (title.includes("lassi")) {
    baseGrams = 15;
    proteinPerServing = 15;
    servingSizeText = "200 mL pack";
  } else if (/\bmilk\b/.test(title)) {
    baseGrams = 35;
    proteinPerServing = 35;
    servingSizeText = "250 mL pack";
  }

  // Tier 2: Metafield & Description Regex Extraction (For novel / unlisted SKUs)
  if (baseGrams === null && metaText) {
    const servingMatch = metaText.match(
      /(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\s*(?:of\s*)?(?:whey\s*)?protein\s*per\s*(\d+(?:\.\d+)?)\s*(?:g|gm|gms|ml)\s*serving/i,
    );
    if (servingMatch) {
      const servingProt = parseFloat(servingMatch[1]);
      const servingSize = parseFloat(servingMatch[2]);
      proteinPerServing = servingProt;
      servingSizeText = `${servingSize}g serving`;
      const packWeightMatch = title.match(/\b(\d+(?:\.\d+)?)\s*(?:g|gm|gms|ml)\b/);
      if (packWeightMatch && servingSize > 0) {
        const packWeight = parseFloat(packWeightMatch[1]);
        const servings = packWeight / servingSize;
        baseGrams = Number((servings * servingProt).toFixed(1));
      } else {
        baseGrams = servingProt;
      }
    } else {
      const metaGMatch = metaText.match(
        /(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\s*(?:of\s*)?(?:whey\s*)?protein(?:\s*per\s*(?:pack|serving|bottle|sachet|unit|tin|can|\d+\s*(?:g|ml|gm)\s*(?:pack|serving|bottle|sachet|tin|can)))?/i,
      );
      if (metaGMatch) {
        baseGrams = parseFloat(metaGMatch[1]);
        proteinPerServing = baseGrams;
      } else {
        const metaPctMatch = metaText.match(
          /(?:high\s*protein\s*[:\-\s]\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:protein|of\s*protein)?/i,
        );
        if (metaPctMatch) {
          const pct = parseFloat(metaPctMatch[1]);
          const unitWeightMatch = title.match(/\b(\d+(?:\.\d+)?)\s*(?:g|gm|gms|ml)\b/);
          if (unitWeightMatch) {
            const unitWeight = parseFloat(unitWeightMatch[1]);
            baseGrams = Number(((pct / 100) * unitWeight).toFixed(1));
            proteinPerServing = baseGrams;
          }
        }
      }
    }
  }

  // Tier 3: Title Fallbacks (Regex patterns in title)
  if (baseGrams === null) {
    const explicitMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\s*(?:of\s*)?protein\b/);
    if (explicitMatch) {
      baseGrams = parseFloat(explicitMatch[1]);
      proteinPerServing = baseGrams;
    }
  }

  if (baseGrams === null) {
    const specificMatch = title.match(/\b(10|15|20|24|25|30|35|40|50|60|70|75|80)\s*(?:g|gm|gms|grams?)\b/);
    if (specificMatch) {
      baseGrams = parseFloat(specificMatch[1]);
      proteinPerServing = baseGrams;
    }
  }

  if (baseGrams === null) {
    const parenMatch = title.match(/\(\s*(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\s*\)/);
    if (parenMatch) {
      const val = parseFloat(parenMatch[1]);
      if (Number.isFinite(val) && val > 0 && val <= 100) {
        baseGrams = val;
        proteinPerServing = val;
      }
    }
  }

  const totalProteinGrams = baseGrams !== null ? Number((baseGrams * multiplier).toFixed(1)) : null;
  return {
    proteinGrams: totalProteinGrams,
    proteinPerServing:
      proteinPerServing ??
      (totalProteinGrams !== null && multiplier > 1 ? Math.round(totalProteinGrams / multiplier) : totalProteinGrams),
    servingSizeText: servingSizeText ?? (multiplier > 1 ? `${multiplier} units` : null),
  };
}

export function extractProteinGrams(
  name: string,
  alias?: string,
  metafields?: Record<string, any> | null,
  description?: string | null,
): number | null {
  return extractNutritionInfo(name, alias, metafields, description).proteinGrams;
}

export function calculateProteinCostPerGram(
  price: number,
  grams: number | null | undefined,
): number | null {
  if (
    typeof price === "number" &&
    price > 0 &&
    typeof grams === "number" &&
    grams > 0 &&
    Number.isFinite(price) &&
    Number.isFinite(grams)
  ) {
    return Number((price / grams).toFixed(2));
  }
  return null;
}

/**
 * Formats protein yield into a crisp mobile-friendly specification string:
 * e.g. "750g · 25g/sachet" or "600g · 20g/shake"
 */
export function formatProteinYield(
  name: string,
  alias?: string,
  totalProteinGrams?: number | null,
): string | null {
  const grams = totalProteinGrams ?? extractProteinGrams(name, alias);
  if (!grams || grams <= 0) return null;

  const multiplier = extractPackMultiplier(name, alias);
  const perServing = multiplier > 1 ? Math.round(grams / multiplier) : grams;

  let unit = "serving";
  const text = `${name || ""} ${alias || ""}`.toLowerCase();
  if (text.includes("sachet") || text.includes("whey") || text.includes("flour") || text.includes("atta")) {
    unit = "sachet";
  } else if (text.includes("shake") || text.includes("smoothie") || text.includes("kool")) {
    unit = "shake";
  } else if (text.includes("buttermilk") || text.includes("chaas") || text.includes("lassi")) {
    unit = "bottle";
  } else if (text.includes("paneer") || text.includes("cube") || /\bmilk\b/.test(text)) {
    unit = "pack";
  } else if (text.includes("spread") || text.includes("butter")) {
    unit = "jar";
  } else if (multiplier > 1) {
    unit = "unit";
  }

  if (multiplier > 1) {
    return `${grams}g · ${perServing}g/${unit}`;
  }
  return `${grams}g (${perServing}g/${unit})`;
}


