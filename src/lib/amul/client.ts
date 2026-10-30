import {
  AMUL_ORIGIN,
  AMUL_STORE_ID,
  type AmulProduct,
  type SavedAddress,
  type SubstoreInfo,
  type UserProfileInfo,
  type SessionVerificationResult,
  calculateProteinCostPerGram,
  extractNutritionInfo,
  extractPackMultiplier,
  extractProteinGrams,
  formatProteinYield,
  isInStock,
  productImageUrl,
  productPageUrl,
} from "./types";
import { lookupSubstore, refreshLiveSubstores } from "./substores";

const BROWSE = `${AMUL_ORIGIN}/en/browse/protein`;

const DEFAULT_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  frontend: "1",
  pragma: "no-cache",
  referer: BROWSE,
  origin: AMUL_ORIGIN,
  base_url: BROWSE,
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
};

const PRODUCT_FIELDS = [
  "name",
  "brand",
  "categories",
  "collections",
  "alias",
  "sku",
  "price",
  "compare_price",
  "original_price",
  "compare_price_discount",
  "compare_price_discount_pct",
  "discounts_total",
  "discounts_percentage",
  "description",
  "images",
  "metafields",
  "discounts",
  "catalog_only",
  "is_catalog",
  "seller",
  "available",
  "inventory_quantity",
  "net_quantity",
  "num_reviews",
  "avg_rating",
  "inventory_low_stock_quantity",
  "inventory_allow_out_of_stock",
  "default_variant",
  "variants",
  "lp_seller_ids",
] as const;

export type PromoBanner = {
  id: string;
  name: string;
  alias: string;
  imageUrl: string;
  image: string;
  publish: string | number | boolean;
  sortOrder: number;
  substore: string[];
  updatedOn?: string;
};

export type CouponValidationResult = {
  valid: boolean;
  discount?: number;
  message?: string;
  couponCode?: string;
};

type RawBanner = {
  _id: string;
  name?: string;
  alias?: string;
  image?: string;
  publish?: string | number | boolean;
  substore?: string[];
  sort_order?: number;
  created_on?: string;
  updated_on?: string;
  metafields?: Record<string, unknown>;
  [key: string]: unknown;
};

type BannersResponse = {
  messages?: unknown[];
  fileBaseUrl?: string;
  data?: RawBanner[];
  paging?: { total?: number; limit?: number; start?: number };
};

type RawProduct = {
  _id: string;
  name: string;
  alias: string;
  sku: string;
  price?: number | string;
  compare_price?: number | string;
  original_price?: number | string;
  compare_price_discount?: number | string;
  compare_price_discount_pct?: number | string;
  discounts_total?: number | string;
  discounts_percentage?: number | string;
  discounts?: Array<{
    _id?: string;
    name?: string;
    saved_amount?: number;
    type?: string;
    amount?: number;
    description?: string;
  }>;
  description?: string;
  metafields?: {
    benefits?: string;
    how_to_useit?: string;
    ingredients?: string;
    uom?: string;
    weight?: string;
    product_type?: string;
    additional_infomation?: string;
    [key: string]: unknown;
  } | Record<string, any>;
  available?: number;
  inventory_quantity?: number;
  inventory_low_stock_quantity?: number;
  inventory_allow_out_of_stock?: string | number | boolean;
  seller_id?: string;
  seller?: { _id?: string } | string;
  lp_seller_ids?: string[];
  images?: Array<{ image?: string }>;
};

export class AmulError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AmulError";
    this.status = status;
    this.code = code;
  }
}

export class AmulClient {
  private jar = new Map<string, string>();
  private tid = "";
  private importedCookie = "";
  private sessionCreatedAt = 0;
  substore: SubstoreInfo | null = null;
  imported = false;
  loggedIn = false;
  isDemoSession = false;
  fallbackAddress: SavedAddress | null = null;
  userId = "";
  userName = "";
  userEmail = "";
  userPhone = "";

  cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  hasSession(): boolean {
    if (this.isDemoSession) return true;
    if (!this.jar.has("jsessionid") || !this.tid) return false;
    // Auto-expire sessions older than 2 hours to avoid stale StoreHippo session issues
    if (this.sessionCreatedAt && Date.now() - this.sessionCreatedAt > 2 * 60 * 60 * 1000) {
      return false;
    }
    return true;
  }

  importCookies(cookieHeader: string) {
    this.jar.clear();
    this.importedCookie = "";
    const raw = cookieHeader.trim();
    if (!raw) return;
    if (raw.includes("demo-verified-customer")) {
      this.isDemoSession = true;
      this.loggedIn = true;
      this.imported = true;
      this.tid = "demo_tid";
      this.jar.set("jsessionid", "demo-verified-customer");
      this.importedCookie = "demo-verified-customer";
      return;
    }
    if (!raw.includes("=")) {
      const val = decodeCookieValue(raw);
      this.jar.set("jsessionid", val);
      this.importedCookie = val;
      this.imported = true;
      return;
    }
    for (const part of raw.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = decodeCookieValue(trimmed.slice(eq + 1).trim());
      if (name) this.jar.set(name, value);
    }
    this.imported = this.jar.has("jsessionid");
    this.importedCookie = this.jar.get("jsessionid") || "";
  }

  async init(sessionCookie?: string): Promise<void> {
    if (sessionCookie?.trim()) {
      this.importCookies(sessionCookie.trim());
    }

    if (this.isDemoSession) {
      this.tid = "demo_tid";
      this.loggedIn = true;
      return;
    }

    if (!this.jar.has("jsessionid")) {
      await this.bootstrapCookies();
      this.imported = false;
    }

    await this.refreshTid();
    if (!this.tid) {
      if (this.imported) {
        throw new AmulError(
          "Imported Amul session did not return a TID. The jsessionid is expired — log in on shop.amul.com and paste it again.",
        );
      }
      await this.bootstrapCookies();
      await this.refreshTid();
    }
    if (!this.tid) {
      throw new AmulError("Amul session did not return a TID");
    }

    // If imported cookie has not registered loggedIn via /user/info.js, check /ms.user_addresses
    if (this.imported && !this.loggedIn && this.jar.has("jsessionid")) {
      try {
        const addrJson = await this.requestJson<Record<string, unknown>>(
          `${AMUL_ORIGIN}/api/1/entity/ms.user_addresses?limit=5`,
        );
        const records = asRecords(addrJson);
        if (records.length > 0) {
          this.loggedIn = true;
          const first = records[0];
          if (!this.userId) {
            this.userId = String(first.user_id || first.userId || "");
          }
        }
      } catch {
        // Not logged in or address endpoint requires distinct auth
      }
    }
  }

  async setPincode(pincode: string): Promise<SubstoreInfo> {
    const pin = pincode.trim();
    if (!/^\d{6}$/.test(pin)) {
      throw new AmulError("Pincode must be 6 digits");
    }

    const url =
      `${AMUL_ORIGIN}/entity/pincode?limit=50` +
      `&filters[0][field]=pincode&filters[0][value]=${encodeURIComponent(pin)}` +
      `&filters[0][operator]=regex&cf_cache=1h`;

    const json = await this.requestJson<PincodeResponse>(url);
    const record = json.records?.[0];
    if (!record?.substore) {
      throw new AmulError(`Amul does not deliver to ${pin}`);
    }

    const rawSlug = String(record.substore || "").toLowerCase().trim();
    await refreshLiveSubstores().catch(() => {});
    const mapped = lookupSubstore(rawSlug);

    await this.requestJson(`${AMUL_ORIGIN}/entity/ms.settings/_/setPreferences`, {
      method: "PUT",
      body: { data: { store: record.substore } },
    }).catch(() => {
      // Preference update is best-effort (can 503 anonymously);
      // explicit substore ID parameter on product queries handles warehouse targeting reliably.
    });

    const info = await this.refreshTid().catch(() => ({}));
    const data = ((info as any)?.data ?? {}) as Record<string, unknown>;
    const sub = ((info as any)?.substore ?? {}) as Record<string, unknown>;
    this.substore = {
      pincode: pin,
      slug: rawSlug,
      id: mapped?.id || String(data.substore_id ?? sub._id ?? ""),
      name: mapped?.name || String(sub.name ?? record.substore),
    };
    return this.substore;
  }

  async listProteinProducts(): Promise<AmulProduct[]> {
    if (!this.substore) {
      throw new AmulError("Set a pincode before listing products");
    }

    // Amul/StoreHippo requires the 24-character hexadecimal ObjectId for warehouse inventory lookup
    const substoreParam =
      this.substore.id || lookupSubstore(this.substore.slug)?.id || this.substore.slug;

    const parts = PRODUCT_FIELDS.map((f) => `fields[${f}]=1`);
    parts.push(
      "filters[0][field]=categories",
      "filters[0][value][0]=protein",
      "filters[0][operator]=in",
      "filters[0][original]=1",
      "facets=true",
      "facetgroup=default_category_facet",
      "limit=80",
      "total=1",
      "start=0",
      "v=6",
      "device_type=other",
      `substore=${encodeURIComponent(substoreParam)}`,
    );

    // StoreHippo serves different inventory when nested query brackets are percent-encoded
    const queryString = parts.join("&").replace(/%5B/g, "[").replace(/%5D/g, "]");

    let json = await this.requestJson<ProductsResponse>(
      `${AMUL_ORIGIN}/api/1/entity/ms.products?${queryString}`,
    );
    let rows = json.data ?? [];

    // StoreHippo returns HTTP 200 with data: [] when the session TID has expired or become invalid.
    // Amul protein category always has SKUs (even when OOS). If rows is empty and session is auto-managed, re-bootstrap and retry once.
    if (rows.length === 0 && !this.imported && !this.isDemoSession) {
      this.tid = "";
      this.jar.clear();
      this.sessionCreatedAt = 0;
      await this.bootstrapCookies();
      await this.refreshTid();
      if (this.substore?.pincode) {
        await this.setPincode(this.substore.pincode);
      }
      const retrySubstoreParam =
        this.substore?.id || lookupSubstore(this.substore?.slug || "")?.id || this.substore?.slug || substoreParam;
      const retryParts = PRODUCT_FIELDS.map((f) => `fields[${f}]=1`);
      retryParts.push(
        "filters[0][field]=categories",
        "filters[0][value][0]=protein",
        "filters[0][operator]=in",
        "filters[0][original]=1",
        "facets=true",
        "facetgroup=default_category_facet",
        "limit=80",
        "total=1",
        "start=0",
        "v=6",
        "device_type=other",
        `substore=${encodeURIComponent(retrySubstoreParam)}`,
      );
      const retryQuery = retryParts.join("&").replace(/%5B/g, "[").replace(/%5D/g, "]");
      const retryJson = await this.requestJson<ProductsResponse>(
        `${AMUL_ORIGIN}/api/1/entity/ms.products?${retryQuery}`,
      );
      rows = retryJson.data ?? [];
    }

    return rows.map(mapProduct);
  }

  async createCart(): Promise<Record<string, unknown>> {
    const json = await this.requestJson<Record<string, unknown>>(
      `${AMUL_ORIGIN}/api/1/entity/ms.carts`,
      { method: "POST", body: { data: {} } },
    );
    return unwrapCart(json);
  }

  async addItem(input: {
    cartId: string;
    productId: string;
    sku: string;
    quantity: number;
    sellerId?: string;
  }): Promise<Record<string, unknown>> {
    return this.command("ms.carts", "addItem", {
      recordId: input.cartId,
      data: {
        product_id: input.productId,
        sku: input.sku,
        quantity: input.quantity,
        seller_id: input.sellerId,
        selected_options: {},
        selected_addons: {},
        variant_id: null,
        linked_product_id: null,
      },
    });
  }

  async listPromoBanners(): Promise<PromoBanner[]> {
    if (this.isDemoSession) {
      return [
        {
          id: "633a741d7bc785c6928a2e2c",
          name: "HB Protein",
          alias: "home-banner-protein",
          imageUrl: `${AMUL_ORIGIN}/s/${AMUL_STORE_ID}/6549e729b86f2d8e7f4b1be1/amul_new_protein-bm_lassi_web-banner.png`,
          image: "6549e729b86f2d8e7f4b1be1/amul_new_protein-bm_lassi_web-banner.png",
          publish: "1",
          sortOrder: 0,
          substore: ["all"],
          updatedOn: "2025-06-25T07:24:24.530Z",
        },
        {
          id: "649a97246f6151125a03fb7d",
          name: "HB Camel Milk Range",
          alias: "hb-camel-milk-range",
          imageUrl: `${AMUL_ORIGIN}/s/${AMUL_STORE_ID}/649a973cc44a9f32ab4c47ac/web-banner_camel-range.png`,
          image: "649a973cc44a9f32ab4c47ac/web-banner_camel-range.png",
          publish: "1",
          sortOrder: 0,
          substore: ["all"],
          updatedOn: "2025-06-25T07:23:49.076Z",
        },
      ];
    }

    if (!this.hasSession()) {
      await this.init();
    }

    const json = await this.requestJson<BannersResponse>(
      `${AMUL_ORIGIN}/api/1/entity/ms.banners?limit=20`,
    );

    const fileBaseUrl = String(json.fileBaseUrl || `${AMUL_ORIGIN}/s/${AMUL_STORE_ID}/`);
    const cleanBase = fileBaseUrl.endsWith("/") ? fileBaseUrl : `${fileBaseUrl}/`;
    const banners = Array.isArray(json.data) ? json.data : [];

    return banners.map((b) => {
      const rawImage = String(b.image || "").trim();
      let imageUrl = "";
      if (rawImage.startsWith("http://") || rawImage.startsWith("https://")) {
        imageUrl = rawImage;
      } else {
        const cleanPath = rawImage.replace(/^\//, "");
        imageUrl = `${cleanBase}${cleanPath}`;
      }
      return {
        id: String(b._id || ""),
        name: String(b.name || ""),
        alias: String(b.alias || ""),
        imageUrl,
        image: rawImage,
        publish: b.publish ?? "1",
        sortOrder: typeof b.sort_order === "number" ? b.sort_order : 0,
        substore: Array.isArray(b.substore) ? b.substore.map(String) : [],
        updatedOn: b.updated_on ? String(b.updated_on) : undefined,
      };
    });
  }

  async checkCoupon(
    couponCode: string,
    cartId?: string,
  ): Promise<CouponValidationResult> {
    const code = String(couponCode || "").trim();
    if (!code) {
      return {
        valid: false,
        discount: 0,
        message: "Coupon code cannot be empty",
        couponCode: "",
      };
    }

    if (this.isDemoSession) {
      if (code.toUpperCase() === "AMUL10" || code.toUpperCase() === "PROTEIN10") {
        return {
          valid: true,
          discount: 100,
          message: "Coupon applied successfully (Demo)",
          couponCode: code,
        };
      }
      return {
        valid: false,
        discount: 0,
        message: "Coupon Code is not valid",
        couponCode: code,
      };
    }

    if (!this.hasSession()) {
      await this.init();
    }

    let targetCartId = cartId;
    if (!targetCartId) {
      const cart = await this.createCart();
      targetCartId = String(cart._id);
    }

    try {
      const cart = await this.command("ms.carts", "applyCoupon", {
        recordId: targetCartId,
        data: { coupon_code: code },
      });

      const discount = Number(cart.discounts_total ?? cart.discount_total ?? 0);

      try {
        await this.command("ms.carts", "removeCoupon", {
          recordId: targetCartId,
          data: {},
        });
      } catch {
        // best effort cleanup
      }

      return {
        valid: true,
        discount,
        message: "Coupon applied successfully",
        couponCode: code,
      };
    } catch (err: unknown) {
      if (
        err instanceof AmulError &&
        (err.status === 406 || err.code === "ms.msg.coupon_rejected")
      ) {
        return {
          valid: false,
          discount: 0,
          message: err.message || "Coupon Code is not valid",
          couponCode: code,
        };
      }
      return {
        valid: false,
        discount: 0,
        message: err instanceof Error ? err.message : String(err),
        couponCode: code,
      };
    }
  }

  async listAddresses(): Promise<SavedAddress[]> {
    if (this.isDemoSession) {
      if (this.fallbackAddress) return [this.fallbackAddress];
      return [
        {
          id: "addr_demo_1",
          label: "Flat 402, Shivalik Heights, CG Road, Navrangpura, Ahmedabad, Gujarat 380009",
          city: "Ahmedabad",
          zip: "380009",
          raw: { full_name: "Rohan Patel", address_line_1: "Flat 402, Shivalik Heights" },
        },
      ];
    }

    let rows: Array<Record<string, unknown>> = [];

    // 1. First attempt: query /ms.user_addresses directly.
    // Amul scopes user addresses to the authenticated session cookie.
    try {
      const json = await this.requestJson<Record<string, unknown>>(
        `${AMUL_ORIGIN}/api/1/entity/ms.user_addresses?limit=20`,
      );
      rows = asRecords(json);
    } catch {
      // ignore
    }

    // 2. Second attempt: if empty and userId is known, try with ?q={user_id}
    if (!rows.length && this.userId) {
      try {
        const q = encodeURIComponent(JSON.stringify({ user_id: this.userId }));
        const jsonWithQ = await this.requestJson<Record<string, unknown>>(
          `${AMUL_ORIGIN}/api/1/entity/ms.user_addresses?q=${q}&limit=20`,
        );
        rows = asRecords(jsonWithQ);
      } catch {
        // ignore
      }
    }

    // 3. Third attempt: check if addresses are embedded inside user profile record
    if (!rows.length && this.userId) {
      try {
        const u = await this.requestJson<Record<string, unknown>>(
          `${AMUL_ORIGIN}/api/1/entity/ms.users/${this.userId}`,
        );
        const data = ((u.data ?? u) as Record<string, any>) || {};
        if (Array.isArray(data.addresses) && data.addresses.length) {
          rows = data.addresses;
        }
      } catch {
        // ignore
      }
    }

    if (!rows.length && this.fallbackAddress) {
      return [this.fallbackAddress];
    }

    return rows.map(mapAddress);
  }

  async fetchUserProfile(): Promise<UserProfileInfo | null> {
    if (!this.loggedIn) return null;
    let addresses: SavedAddress[] = [];
    try {
      addresses = await this.listAddresses();
    } catch {
      // ignore
    }
    const defaultAddr =
      addresses.find((a) => {
        const r = a.raw;
        return Boolean(r.is_default || r.isDefault || r.default);
      }) || addresses[0] || null;

    let name = this.userName;
    let phone = this.userPhone;
    let email = this.userEmail;

    if (defaultAddr) {
      const r = defaultAddr.raw;
      if (!name) name = String(r.full_name ?? r.name ?? "");
      if (!phone) phone = String(r.phone ?? r.mobile ?? r.contact ?? "");
      if (!email) email = String(r.email ?? "");
    }

    if (!name && this.userId) {
      try {
        const u = await this.requestJson<Record<string, unknown>>(
          `${AMUL_ORIGIN}/api/1/entity/ms.users/${this.userId}`,
        );
        const data = (u.data ?? u) as Record<string, unknown>;
        if (data) {
          name = String(
            data.name ??
              [data.first_name, data.last_name].filter(Boolean).join(" ") ??
              "",
          );
          if (!phone) phone = String(data.phone ?? data.mobile ?? "");
          if (!email) email = String(data.email ?? "");
        }
      } catch {
        // ignore
      }
    }

    return {
      userId: this.userId,
      userName: name || "Amul Customer",
      userEmail: email || undefined,
      userPhone: phone || undefined,
      defaultAddress: defaultAddr,
      addressCount: addresses.length,
    };
  }

  async verifySession(sessionCookie?: string): Promise<SessionVerificationResult> {
    try {
      if (sessionCookie !== undefined) {
        await this.init(sessionCookie);
      } else {
        await this.init();
      }

      if (
        this.imported &&
        this.importedCookie &&
        this.jar.get("jsessionid") !== this.importedCookie
      ) {
        return {
          valid: false,
          loggedIn: false,
          message:
            "Amul rejected this cookie (expired or invalid). Please log into shop.amul.com and copy a fresh jsessionid.",
        };
      }

      if (!this.loggedIn) {
        if (this.imported) {
          return {
            valid: true,
            loggedIn: false,
            message:
              "Session cookie was recognized, but Amul does not register an active logged-in customer. Make sure you are signed in on shop.amul.com before copying jsessionid.",
          };
        }
        return {
          valid: false,
          loggedIn: false,
          message: "No active session cookie provided.",
        };
      }

      const profile = await this.fetchUserProfile();
      return {
        valid: true,
        loggedIn: true,
        profile,
        message: profile
          ? `Connected to ${profile.userName}${profile.defaultAddress ? ` · ${profile.defaultAddress.label}` : ""}`
          : "Session active",
      };
    } catch (err) {
      return {
        valid: false,
        loggedIn: false,
        message: err instanceof Error ? err.message : "Session verification failed",
      };
    }
  }

  async updateAddresses(cartId: string, address: Record<string, unknown>) {
    const shipping = { ...address };
    return this.command("ms.carts", "updateAddresses", {
      recordId: cartId,
      data: {
        shipping_address: shipping,
        billing_address: shipping,
      },
    });
  }

  async getPaymentMethods(cartId: string): Promise<unknown[]> {
    const json = await this.command("ms.carts", "getPaymentMethods", {
      recordId: cartId,
      data: {},
    });
    const methods = json.methods ?? json.available_payment_methods;
    return Array.isArray(methods) ? methods : [];
  }

  async updatePaymentMethod(
    cartId: string,
    paymentMethod: Record<string, unknown>,
  ) {
    const gateway =
      nestedString(paymentMethod, ["settings", "gateway"]) ||
      nestedString(paymentMethod, ["settings", "gateways", "0", "gateway"]) ||
      undefined;
    return this.command("ms.carts", "updatePaymentMethod", {
      recordId: cartId,
      data: {
        payment_method: {
          _id: paymentMethod._id,
          settings: gateway ? { gateway } : {},
        },
      },
    });
  }

  async placeOrder(cartId: string) {
    return this.command("ms.carts", "placeOrder", {
      recordId: cartId,
      data: { client_details: {}, payment_response: {} },
    });
  }

  async command(
    entity: string,
    command: string,
    opts: { recordId?: string; data?: unknown } = {},
  ): Promise<Record<string, unknown>> {
    let url = `${AMUL_ORIGIN}/api/1/entity/${entity}`;
    if (opts.recordId) url += `/${opts.recordId}`;
    url += `/_/${command}`;
    if (opts.recordId) {
      url += `?q=${encodeURIComponent(JSON.stringify({ _id: opts.recordId }))}`;
    }
    const json = await this.requestJson<Record<string, unknown>>(url, {
      method: "PUT",
      body: { data: opts.data ?? {} },
    });
    return unwrapCart(json);
  }

  private async bootstrapCookies() {
    const res = await fetch(BROWSE, {
      method: "GET",
      headers: {
        ...DEFAULT_HEADERS,
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    this.ingestCookies(res);
    if (!this.jar.has("jsessionid")) {
      throw new AmulError(`Could not start an Amul session (${res.status})`, res.status);
    }
  }

  private async refreshTid(): Promise<SessionInfo> {
    if (this.isDemoSession) {
      this.tid = "demo_tid";
      this.loggedIn = true;
      return { tid: "demo_tid" };
    }
    const raw = await this.requestText(`${AMUL_ORIGIN}/user/info.js?_v=${Date.now()}`);
    const info = parseSessionScript(raw);
    if (info.tid) {
      this.tid = info.tid;
      this.sessionCreatedAt = Date.now();
    }
    const user = (info.user ?? {}) as Record<string, any>;
    const infoData = (info.data ?? {}) as Record<string, any>;
    const resolvedId = String(user._id ?? infoData.user_id ?? this.userId ?? "");
    if (resolvedId) this.userId = resolvedId;
    this.loggedIn = Boolean(user.isLoggedIn || this.userId || this.loggedIn);
    const uName = String(
      user.name ||
        [user.first_name, user.last_name].filter(Boolean).join(" ") ||
        infoData.name ||
        this.userName ||
        "",
    );
    if (uName) this.userName = uName;
    const uEmail = String(user.email ?? infoData.email ?? "");
    if (uEmail) this.userEmail = uEmail;
    const uPhone = String(user.phone ?? user.mobile ?? infoData.phone ?? "");
    if (uPhone) this.userPhone = uPhone;
    return info;
  }

  private async tidHeader(): Promise<string> {
    if (!this.tid) throw new AmulError("Amul session TID is not initialized");
    const timestamp = Date.now().toString();
    const rand = Math.floor(1000 * Math.random());
    const payload = `${AMUL_STORE_ID}:${timestamp}:${rand}:${this.tid}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${timestamp}:${rand}:${hash}`;
  }

  private async requestJson<T>(
    url: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const text = await this.requestText(url, init);
    if (!text) return {} as T;
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return { message: trimmed } as T;
    }
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      throw new AmulError(`Amul returned a non-JSON response from ${safePath(url)}`);
    }
  }

  private async requestText(
    url: string,
    init: { method?: string; body?: unknown } = {},
    attempt = 0,
  ): Promise<string> {
    const tid = await this.tidHeader().catch(() => "");
    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      cookie: this.cookieHeader(),
    };
    if (tid) headers.tid = tid;
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    this.ingestCookies(res);
    const text = await res.text();

    if ((res.status === 401 || res.status === 403) && attempt < 1 && !this.imported) {
      this.tid = "";
      await this.bootstrapCookies();
      await this.refreshTid();
      return this.requestText(url, init, attempt + 1);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AmulError("Amul session expired or was rejected", res.status);
    }
    if (res.status >= 500 && attempt < 1) {
      await sleep(400 + Math.random() * 400);
      return this.requestText(url, init, attempt + 1);
    }
    if (!res.ok) {
      throw new AmulError(extractAmulMessage(text, res.status), res.status, extractAmulCode(text));
    }
    return text;
  }

  private ingestCookies(res: Response) {
    const raw =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : cookieFallback(res.headers.get("set-cookie"));
    for (const entry of raw) {
      const pair = entry.split(";")[0];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = decodeCookieValue(pair.slice(eq + 1).trim());
      if (name) this.jar.set(name, value);
    }
  }
}

export function mapProduct(row: RawProduct): AmulProduct {
  const available = Number(row.available ?? 0);
  const inventory = Number(row.inventory_quantity ?? 0);
  const lowStock = Number(row.inventory_low_stock_quantity ?? 0);
  const allowOos =
    row.inventory_allow_out_of_stock !== undefined &&
    row.inventory_allow_out_of_stock !== "0" &&
    row.inventory_allow_out_of_stock !== 0 &&
    row.inventory_allow_out_of_stock !== false;
  const seller =
    typeof row.seller === "string" ? row.seller : (row.seller_id ?? row.seller?._id);
  const rawPrice = Number(row.price ?? 0);
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0;

  // Parse compare_price safely handling "" (empty string), string numbers, and numbers
  let rawComparePrice: number | null = null;
  if (typeof row.compare_price === "number" && Number.isFinite(row.compare_price) && row.compare_price > 0) {
    rawComparePrice = row.compare_price;
  } else if (typeof row.compare_price === "string" && row.compare_price.trim() !== "") {
    const parsed = Number(row.compare_price.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      rawComparePrice = parsed;
    }
  }

  // Parse original_price safely
  let rawOriginalPrice: number | null = null;
  if (typeof row.original_price === "number" && Number.isFinite(row.original_price) && row.original_price > 0) {
    rawOriginalPrice = row.original_price;
  } else if (typeof row.original_price === "string" && row.original_price.trim() !== "") {
    const parsed = Number(row.original_price.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      rawOriginalPrice = parsed;
    }
  }

  const rawDiscountsTotal = Number(row.discounts_total ?? 0);
  const discountsTotal = Number.isFinite(rawDiscountsTotal) && rawDiscountsTotal > 0 ? rawDiscountsTotal : 0;

  const rawCompareDiscount = Number(row.compare_price_discount ?? 0);
  const comparePriceDiscount = Number.isFinite(rawCompareDiscount) && rawCompareDiscount > 0 ? rawCompareDiscount : 0;

  let comparePrice: number | null = null;
  let discountAmount: number | null = null;
  let discountPct: number | null = null;

  if (price > 0) {
    if (rawComparePrice !== null && rawComparePrice > price) {
      comparePrice = rawComparePrice;
    } else if (rawOriginalPrice !== null && rawOriginalPrice > price) {
      comparePrice = rawOriginalPrice;
    } else if (discountsTotal > 0) {
      comparePrice = price + discountsTotal;
    } else if (comparePriceDiscount > 0) {
      comparePrice = price + comparePriceDiscount;
    }
  }

  if (comparePrice !== null && price > 0 && comparePrice > price) {
    discountAmount = Number((comparePrice - price).toFixed(2));
    discountPct = Math.round((discountAmount / comparePrice) * 100);
  } else {
    comparePrice = null;
    discountAmount = null;
    discountPct = null;
  }

  const nutrition = extractNutritionInfo(
    row.name,
    row.alias,
    row.metafields,
    row.description,
  );
  const proteinGrams = extractProteinGrams(
    row.name,
    row.alias,
    row.metafields,
    row.description,
  );
  const costPerGramProtein = calculateProteinCostPerGram(price, proteinGrams);

  const multiplier = extractPackMultiplier(row.name, row.alias);
  const proteinPerServing =
    nutrition.proteinPerServing ??
    (proteinGrams && proteinGrams > 0
      ? (multiplier > 1 ? Number((proteinGrams / multiplier).toFixed(1)) : proteinGrams)
      : null);
  const servingSizeText = nutrition.servingSizeText ?? formatProteinYield(row.name, row.alias, proteinGrams);

  return {
    id: row._id,
    sku: row.sku,
    name: row.name,
    alias: row.alias,
    price,
    comparePrice,
    discountAmount,
    discountPct,
    available,
    inventoryQuantity: inventory,
    inventoryLowStock: lowStock,
    inStock: isInStock(available, inventory, lowStock, allowOos),
    imageUrl: productImageUrl(row.images?.[0]?.image),
    sellerId: seller,
    productUrl: productPageUrl(row.alias),
    proteinGrams,
    costPerGramProtein,
    proteinPerServing,
    servingSizeText,
  };
}

function mapAddress(row: Record<string, unknown>): SavedAddress {
  const fullName = String(row.full_name ?? row.name ?? "");
  const city = String(row.city ?? "");
  const zip = String(row.zip ?? row.pincode ?? "");
  const line = String(row.address ?? row.address1 ?? "");
  const label = [fullName, line, city, zip].filter(Boolean).join(" · ") || "Saved address";
  return {
    id: String(row._id ?? ""),
    label,
    city: city || undefined,
    zip: zip || undefined,
    raw: row,
  };
}

function unwrapCart(json: Record<string, unknown>): Record<string, unknown> {
  const inner =
    json.data && typeof json.data === "object" && !Array.isArray(json.data)
      ? (json.data as Record<string, unknown>)
      : json;
  if (inner.cart && typeof inner.cart === "object") {
    return inner.cart as Record<string, unknown>;
  }
  if (json.cart && typeof json.cart === "object") {
    return json.cart as Record<string, unknown>;
  }
  return inner;
}

function asRecords(json: Record<string, unknown> | null | undefined): Array<Record<string, unknown>> {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json.data)) return json.data as Array<Record<string, unknown>>;
  if (Array.isArray(json.records)) return json.records as Array<Record<string, unknown>>;
  if (Array.isArray(json)) return json as unknown as Array<Record<string, unknown>>;
  const inner = json.data;
  if (inner && typeof inner === "object") {
    if (Array.isArray((inner as { data?: unknown }).data)) {
      return (inner as { data: Array<Record<string, unknown>> }).data;
    }
    if (Array.isArray((inner as { records?: unknown }).records)) {
      return (inner as { records: Array<Record<string, unknown>> }).records;
    }
  }
  return [];
}

function nestedString(obj: Record<string, unknown>, path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur)
      ? cur[Number(key)]
      : (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : undefined;
}

function extractAmulMessage(text: string, status: number): string {
  try {
    const json = JSON.parse(text) as {
      message?: string;
      err?: { message?: string };
      error?: { name?: string };
      data?: { message?: string; error?: { name?: string } };
    };
    const code = json.error?.name || json.data?.error?.name;
    if (code === "ms.msg.item_unavailable") {
      return "SKU is unavailable for this substore or quantity";
    }
    return (
      json.message ||
      json.data?.message ||
      json.err?.message ||
      code ||
      `Amul error ${status}`
    );
  } catch {
    if (text.startsWith("<!")) return `Amul returned HTML (${status})`;
    return text.trim() || `Amul error ${status}`;
  }
}

function extractAmulCode(text: string): string | undefined {
  try {
    const json = JSON.parse(text) as { error?: { name?: string } };
    return json.error?.name;
  } catch {
    return undefined;
  }
}

function parseSessionScript(raw: string): SessionInfo {
  const trimmed = raw.replace(/^\s*session\s*=\s*/, "").trim();
  try {
    return JSON.parse(trimmed) as SessionInfo;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as SessionInfo;
    }
    throw new AmulError("Could not parse Amul session");
  }
}

function decodeCookieValue(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cookieFallback(header: string | null): string[] {
  return header ? [header] : [];
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "request";
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type PincodeResponse = {
  records?: Array<{ pincode: string; substore: string }>;
};

type ProductsResponse = {
  data?: RawProduct[];
};

type SessionInfo = {
  tid?: string;
  user?: {
    _id?: string;
    isLoggedIn?: boolean;
  };
  data?: {
    store?: string;
    substore_id?: string;
    user_id?: string;
  };
  substore?: {
    _id?: string;
    name?: string;
    alias?: string;
  };
};
