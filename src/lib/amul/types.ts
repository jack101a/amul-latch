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
  | "session_ready"
  | "session_expired"
  | "pincode_set"
  | "poll"
  | "restock"
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
  available: number;
  inventoryQuantity: number;
  inventoryLowStock: number;
  inStock: boolean;
  imageUrl: string | null;
  sellerId?: string;
  productUrl: string;
  proteinGrams?: number | null;
  costPerGramProtein?: number | null;
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
};

export const DEFAULT_CONFIG: AppConfig = {
  pincode: "",
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

export function productImageUrl(image: string | undefined | null): string | null {
  if (!image) return null;
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

export function maskSecret(value: string): string {
  const v = value.trim();
  if (v.length <= 6) return v ? "••••" : "";
  return `${v.slice(0, 3)}…${v.slice(-3)}`;
}

export function extractPackMultiplier(name: string, alias?: string): number {
  const text = `${name || ""} ${alias || ""}`.toLowerCase();

  // 1. "pack of 30", "pack of 10", "pack of 8", "pack of 32"
  const packOfMatch = text.match(/\bpack\s*of\s*(\d{1,3})\b/);
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

export function extractProteinGrams(name: string, alias?: string): number | null {
  const text = `${name || ""} ${alias || ""}`.toLowerCase();
  let baseGrams: number | null = null;

  // 1. Explicit "<num>g protein" or "<num> g of protein" (e.g. "15g Protein", "25 g Protein", "35g of protein")
  const explicitMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\s*(?:of\s*)?protein\b/);
  if (explicitMatch) {
    const val = parseFloat(explicitMatch[1]);
    if (Number.isFinite(val) && val > 0) baseGrams = val;
  }

  // 2. Slug style in aliases (e.g. "25g-protein", "15g-protein", "protein-25g")
  if (baseGrams === null) {
    const slugMatch =
      text.match(/(?:^|[-_])(\d+(?:\.\d+)?)-?g-?protein\b/) ||
      text.match(/\bprotein-?(\d+(?:\.\d+)?)-?g(?:[-_]|$)/);
    if (slugMatch) {
      const val = parseFloat(slugMatch[1]);
      if (Number.isFinite(val) && val > 0) baseGrams = val;
    }
  }

  // 3. "protein <num>g" (e.g. "Protein: 25g" or "protein - 15g")
  if (baseGrams === null) {
    const prefixMatch = text.match(
      /protein\s*(?:content|contains)?\s*[:\-\s]\s*(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\b/,
    );
    if (prefixMatch) {
      const val = parseFloat(prefixMatch[1]);
      if (Number.isFinite(val) && val > 0) baseGrams = val;
    }
  }

  // 4. Parentheses with gram e.g. "(15g)" or "(25 g)" or "(35g)" or "(70 g)"
  if (baseGrams === null) {
    const parenMatch = text.match(/\(\s*(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\s*\)/);
    if (parenMatch) {
      const val = parseFloat(parenMatch[1]);
      if (Number.isFinite(val) && val > 0 && val <= 100) baseGrams = val;
    }
  }

  // 5. Explicit standalone protein gram patterns e.g. " 10g", " 15g", " 20g", " 24 g", " 25g", " 35g", " 70 g"
  if (baseGrams === null) {
    const specificMatch = text.match(/\b(10|15|20|24|25|30|35|40|50|60|70|75|80)\s*(?:g|gm|gms|grams?)\b/);
    if (specificMatch) {
      const val = parseFloat(specificMatch[1]);
      if (Number.isFinite(val) && val > 0) baseGrams = val;
    }
  }

  // 6. Whey sachet handling:
  // Amul Whey Protein sachets are 32g-34g gross powder weight containing 24g-25g protein.
  if (
    baseGrams === null &&
    text.includes("whey") &&
    (text.includes("32") || text.includes("34") || text.includes("sachet"))
  ) {
    baseGrams = text.includes("32") ? 24 : 25;
  } else if (
    baseGrams === null &&
    text.includes("sachet") &&
    (text.includes("32") || text.includes("34"))
  ) {
    baseGrams = 25;
  }

  // 7. General number with "g" if 10 <= val <= 85 (excluding pack weights like 200g, 250ml, etc.)
  if (baseGrams === null) {
    const genericGMatch = text.match(/\b(\d{1,2}(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\b/);
    if (genericGMatch) {
      const val = parseFloat(genericGMatch[1]);
      if (Number.isFinite(val) && val >= 10 && val <= 85) baseGrams = val;
    }
  }

  // 8. Product fallbacks for standard Amul offerings
  if (baseGrams === null) {
    if (text.includes("lassi")) baseGrams = 15;
    else if (text.includes("buttermilk") || text.includes("chaas") || text.includes("chach")) baseGrams = 15;
    else if (text.includes("kool") && (text.includes("shake") || text.includes("milkshake"))) baseGrams = 10;
    else if (text.includes("shake")) baseGrams = 20;
    else if (text.includes("paneer")) baseGrams = 50;
    else if (text.includes("whey")) baseGrams = 25;
  }

  if (baseGrams === null) return null;

  const multiplier = extractPackMultiplier(name, alias);
  return Number((baseGrams * multiplier).toFixed(1));
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
  if (text.includes("sachet") || text.includes("whey")) {
    unit = "sachet";
  } else if (text.includes("shake") || text.includes("smoothie") || text.includes("kool")) {
    unit = "shake";
  } else if (text.includes("buttermilk") || text.includes("chaas") || text.includes("lassi")) {
    unit = "bottle";
  } else if (text.includes("paneer")) {
    unit = "pack";
  } else if (multiplier > 1) {
    unit = "unit";
  }

  if (multiplier > 1) {
    return `${grams}g · ${perServing}g/${unit}`;
  }
  return `${grams}g (${perServing}g/${unit})`;
}


