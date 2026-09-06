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
