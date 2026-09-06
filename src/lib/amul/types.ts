export const AMUL_ORIGIN = "https://shop.amul.com";
export const AMUL_STORE_ID = "62fa94df8c13af2e242eba16";
export const TELEGRAM_ORIGIN = "https://api.telegram.org";

export const EXTERNAL_DOMAINS = [
  {
    host: "shop.amul.com",
    why: "Official Amul shop — session, pincode, stock, cart, and checkout",
  },
  {
    host: "api.telegram.org",
    why: "Telegram Bot API — restock and payment notifications only",
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
  | "telegram"
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
  autoOrder: boolean;
  orderIfAlreadyInStock: boolean;
  soundEnabled: boolean;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  sessionCookie: string;
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
  startedAt: string;
  status: "running" | "awaiting_payment" | "success" | "failed" | "blocked";
  message: string;
  paymentUrl?: string;
  cartId?: string;
  shopUrl?: string;
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
  sessionImported: boolean;
  sessionLoggedIn: boolean;
  userProfile?: UserProfileInfo | null;
  lastTickAt: string | null;
  nextPollMs: number;
  pollCount: number;
  products: AmulProduct[];
  tracked: TrackedProduct[];
  autoOrder: boolean;
  events: ActivityEvent[];
  checkout: CheckoutAttempt | null;
  lastError: string | null;
  amulReachable: boolean;
};

export const DEFAULT_CONFIG: AppConfig = {
  pincode: "",
  products: [],
  autoOrder: false,
  orderIfAlreadyInStock: false,
  soundEnabled: true,
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  sessionCookie: "",
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

export function productPageUrl(alias: string): string {
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

export function extractProteinGrams(name: string, alias?: string): number | null {
  const text = `${name || ""} ${alias || ""}`.toLowerCase();

  // 1. Explicit "<num>g protein" or "<num> g of protein" (e.g. "15g Protein", "25 g Protein", "35g of protein")
  const explicitMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\s*(?:of\s*)?protein\b/);
  if (explicitMatch) {
    const val = parseFloat(explicitMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // 2. Slug style in aliases (e.g. "25g-protein", "15g-protein", "protein-25g")
  const slugMatch =
    text.match(/(?:^|[-_])(\d+(?:\.\d+)?)-?g-?protein\b/) ||
    text.match(/\bprotein-?(\d+(?:\.\d+)?)-?g(?:[-_]|$)/);
  if (slugMatch) {
    const val = parseFloat(slugMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // 3. "protein <num>g" (e.g. "Protein: 25g" or "protein - 15g")
  const prefixMatch = text.match(
    /protein\s*(?:content|contains)?\s*[:\-\s]\s*(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\b/,
  );
  if (prefixMatch) {
    const val = parseFloat(prefixMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // 4. Parentheses with gram e.g. "(15g)" or "(25 g)" or "(35g)" or "(70 g)"
  const parenMatch = text.match(/\(\s*(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\s*\)/);
  if (parenMatch) {
    const val = parseFloat(parenMatch[1]);
    if (Number.isFinite(val) && val > 0 && val <= 100) return val;
  }

  // 5. Explicit standalone protein gram patterns e.g. " 15g", " 24 g", " 25g", " 35g", " 70 g"
  const specificMatch = text.match(/\b(15|24|25|30|35|40|50|60|70|75|80)\s*(?:g|gm|gms|grams?)\b/);
  if (specificMatch) {
    const val = parseFloat(specificMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // 6. General number with "g" if 10 <= val <= 85 (excluding pack weights like 200g, 250ml, etc.)
  const genericGMatch = text.match(/\b(\d{1,2}(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\b/);
  if (genericGMatch) {
    const val = parseFloat(genericGMatch[1]);
    if (Number.isFinite(val) && val >= 10 && val <= 85) return val;
  }

  // 7. Whey sachet fallback:
  // Amul Whey Protein sachets are typically 32g gross powder weight containing 25g protein.
  if (text.includes("sachet") && (text.includes("whey") || text.includes("32"))) {
    return 25;
  }

  // 8. Product fallbacks for standard Amul offerings
  if (text.includes("lassi")) return 15;
  if (text.includes("buttermilk") || text.includes("chaas") || text.includes("chach")) return 15;
  if (text.includes("paneer")) return 50;
  if (text.includes("whey")) return 25;

  return null;
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

