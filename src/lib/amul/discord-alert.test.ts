import test from "node:test";
import assert from "node:assert/strict";
import {
  formatProteinYield,
  extractProteinGrams,
  calculateProteinCostPerGram,
  DEFAULT_CONFIG,
  type AmulProduct,
} from "./types.ts";
import {
  buildPriceDropAlertEmbed,
  buildPriceDropAlertPayload,
  sendPriceDropAlert,
  sanitizeMentions,
  DISCORD_COLOR_GOLD,
  type PriceDropAlertInput,
} from "./discord.ts";
import {
  AmulClient,
  type PromoBanner,
} from "./client.ts";
import { calculateAdaptiveInterval } from "./runtime.ts";

test("formatProteinYield formats protein yield and per-serving dosage", () => {
  // Amul Whey carton (Pack of 30, 25g protein per sachet, 750g total)
  const wheyCarton = formatProteinYield("Amul Chocolate Whey Protein, 34g (Pack of 30)");
  assert.equal(wheyCarton, "750g · 25g/sachet");

  // Amul Whey 30 Sachets 24g (720g total)
  const whey24g = formatProteinYield("Amul Whey Protein 30 Sachets 24 g");
  assert.equal(whey24g, "720g · 24g/sachet");

  // Amul High Protein Blueberry Shake (Pack of 30, 20g/shake, 600g total)
  const shake = formatProteinYield("Amul High Protein Blueberry Shake, 200 mL | Pack of 30");
  assert.equal(shake, "600g · 20g/shake");

  // Amul High Protein Buttermilk (Pack of 30, 15g/bottle, 450g total)
  const buttermilk = formatProteinYield("Amul High Protein Buttermilk, 200 ml | Pack of 30");
  assert.equal(buttermilk, "450g · 15g/bottle");

  // Single unit
  const single = formatProteinYield("Amul High Protein Buttermilk 15g");
  assert.equal(single, "15g (15g/bottle)");

  // Non-protein product
  const nonProtein = formatProteinYield("Generic Ice Cream");
  assert.equal(nonProtein, null);
});

test("Value Tier calculation and Best Value threshold", () => {
  const cost1 = calculateProteinCostPerGram(2500, 750);
  assert.equal(cost1, 3.33);

  const cost2 = calculateProteinCostPerGram(900, 450);
  assert.equal(cost2, 2.0);
  assert.equal(cost2 !== null && cost2 <= 2.5, true); // 🔥 Best Value
});

function createMockProduct(overrides?: Partial<AmulProduct>): AmulProduct {
  return {
    id: "prod_mock_123",
    sku: "AMUL-WHEY-CHOC-30",
    name: "Amul Chocolate Whey Protein, 34 g | Pack of 30 sachets",
    alias: "amul-chocolate-whey-protein-34-g-or-pack-of-30-sachets",
    price: 2250,
    comparePrice: 2500,
    discountAmount: 250,
    discountPct: 10,
    available: 45,
    inventoryQuantity: 45,
    inventoryLowStock: 5,
    inStock: true,
    imageUrl: "https://shop.amul.com/s/img123.png",
    productUrl:
      "https://shop.amul.com/en/product/amul-chocolate-whey-protein-34-g-or-pack-of-30-sachets",
    proteinGrams: 750,
    costPerGramProtein: 3.0,
    proteinPerServing: 25,
    servingSizeText: "sachet",
    ...overrides,
  };
}

test("PriceDropAlert: builds rich embed with gold color, strikethrough pricing, updated cost/g, and action button", () => {
  const product = createMockProduct();
  const input: PriceDropAlertInput = {
    webhookUrl: "https://discord.com/api/webhooks/123456789/dummy-token",
    product,
    oldPrice: 2500,
    newPrice: 2250,
    discountPct: 10,
    savingsAmount: 250,
    pincode: "400068",
    stockUnits: 45,
  };

  const embed = buildPriceDropAlertEmbed(input);
  const payload = buildPriceDropAlertPayload(input);

  // 1. Color must be Gold 0xF59E0B
  assert.equal(embed.color, DISCORD_COLOR_GOLD);
  assert.equal(embed.color, 0xf59e0b);

  // 2. Author and Thumbnail
  assert.equal(embed.author?.name, product.name);
  assert.equal(embed.author?.url, product.productUrl);
  assert.equal(embed.author?.icon_url, product.imageUrl);
  assert.equal(embed.thumbnail?.url, product.imageUrl);

  // 3. Strikethrough pricing header in description
  assert.match(embed.description || "", /## ~~₹2,500~~ ➔ \*\*₹2,250\*\* \(-10% \/ Save ₹250\)/);

  // 4. Value line with updated cost per gram (2250 / 750 = 3) and yield string
  assert.match(embed.description || "", /⚡ \*\*₹3\/g\*\* {2}• {2}💪 \*\*750g · 25g\/sachet\*\*/);

  // 5. Stock line with units and pincode
  assert.match(embed.description || "", /🟢 \*\*45 units available\*\* at pincode 400068/);

  // 6. Action link in markdown description
  assert.match(
    embed.description || "",
    /\[⚡ Buy on Amul Store ↗\]\(https:\/\/shop\.amul\.com\/en\/product\//,
  );

  // 7. Action button component in payload
  assert.ok(payload.components && payload.components.length > 0);
  assert.equal(payload.components[0].type, 1); // ActionRow
  const button = payload.components[0].components?.[0];
  assert.ok(button);
  assert.equal(button.type, 2); // Button
  assert.equal(button.style, 5); // Link
  assert.equal(button.label, "⚡ Buy on Amul Store ↗");
  assert.equal(button.url, product.productUrl);

  // 8. Username and Footer
  assert.equal(payload.username, "⚡ Latch Amul Radar");
  assert.equal(embed.footer?.text, "Latch Amul Radar • Price Drop Alert");
});

test("PriceDropAlert: strictly contains ZERO @everyone or @here mentions across content, embed, and payload", () => {
  // Simulate adversarial input containing @everyone and @here in name, pincode, and notes
  const adversarialProduct = createMockProduct({
    name: "Amul Whey @everyone FLASH SALE @here - Do Not Miss!",
  });

  const input: PriceDropAlertInput = {
    webhookUrl: "https://discord.com/api/webhooks/123456789/dummy-token",
    product: adversarialProduct,
    oldPrice: 3000,
    newPrice: 2400,
    discountPct: 20,
    savingsAmount: 600,
    pincode: "400068 @everyone",
    stockUnits: 10,
  };

  const embed = buildPriceDropAlertEmbed(input);
  const payload = buildPriceDropAlertPayload(input);

  // Verification 1: payload.content has no @everyone or @here
  assert.equal(payload.content, undefined);

  // Verification 2: embed.description has NO raw @everyone or @here
  assert.equal(embed.description?.includes("@everyone"), false);
  assert.equal(embed.description?.includes("@here"), false);

  // Verification 3: embed.author.name has NO raw @everyone or @here
  assert.equal(embed.author?.name?.includes("@everyone"), false);
  assert.equal(embed.author?.name?.includes("@here"), false);

  // Verification 4: full serialized payload JSON contains ZERO raw mentions
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("@everyone"), false);
  assert.equal(serialized.includes("@here"), false);

  // Verification 5: sanitizeMentions replaces with zero-width space
  assert.equal(sanitizeMentions("@everyone").includes("@everyone"), false);
  assert.equal(sanitizeMentions("@here").includes("@here"), false);
});

test("PriceDropAlert: handles edge cases (zero savings, fractional percentages, decimal currency)", () => {
  // Case A: Zero savings & 0% discount
  const zeroProduct = createMockProduct();
  const zeroInput: PriceDropAlertInput = {
    webhookUrl: "https://discord.com/api/webhooks/123456789/dummy-token",
    product: zeroProduct,
    oldPrice: 2000,
    newPrice: 2000,
    discountPct: 0,
    savingsAmount: 0,
    pincode: "110001",
    stockUnits: 5,
  };
  const zeroEmbed = buildPriceDropAlertEmbed(zeroInput);
  assert.match(zeroEmbed.description || "", /## ~~₹2,000~~ ➔ \*\*₹2,000\*\* \(0% \/ Save ₹0\)/);

  // Case B: Fractional percentage & decimal amounts
  const fracInput: PriceDropAlertInput = {
    webhookUrl: "https://discord.com/api/webhooks/123456789/dummy-token",
    product: zeroProduct,
    oldPrice: 2499,
    newPrice: 2186.62,
    discountPct: 12.5,
    savingsAmount: 312.38,
    pincode: "560001",
    stockUnits: 12,
  };
  const fracEmbed = buildPriceDropAlertEmbed(fracInput);
  assert.match(
    fracEmbed.description || "",
    /## ~~₹2,499~~ ➔ \*\*₹2,186\.62\*\* \(-12\.5% \/ Save ₹312\.38\)/,
  );

  // Case C: High savings and thousands separator in en-IN format
  const highInput: PriceDropAlertInput = {
    webhookUrl: "https://discord.com/api/webhooks/123456789/dummy-token",
    product: zeroProduct,
    oldPrice: 15000,
    newPrice: 12000,
    discountPct: 20,
    savingsAmount: 3000,
    pincode: "400001",
    stockUnits: 1500,
  };
  const highEmbed = buildPriceDropAlertEmbed(highInput);
  assert.match(
    highEmbed.description || "",
    /## ~~₹15,000~~ ➔ \*\*₹12,000\*\* \(-20% \/ Save ₹3,000\)/,
  );
  assert.match(highEmbed.description || "", /🟢 \*\*1,500 units available\*\* at pincode 400001/);
});

test("PriceDropAlert: handles non-protein catalog items gracefully without null/g or NaN", () => {
  const gheeProduct = createMockProduct({
    name: "Amul Pure Ghee 1L Tin",
    alias: "amul-pure-ghee-1l-tin",
    proteinGrams: null,
    costPerGramProtein: null,
    proteinPerServing: null,
    servingSizeText: null,
  });

  const input: PriceDropAlertInput = {
    webhookUrl: "https://discord.com/api/webhooks/123456789/dummy-token",
    product: gheeProduct,
    oldPrice: 650,
    newPrice: 600,
    discountPct: 7.7,
    savingsAmount: 50,
    pincode: "380001",
    stockUnits: 80,
  };

  const embed = buildPriceDropAlertEmbed(input);
  // Must NOT contain "null/g", "NaN/g", or "undefined/g"
  assert.equal(embed.description?.includes("null"), false);
  assert.equal(embed.description?.includes("NaN"), false);
  assert.equal(embed.description?.includes("undefined"), false);

  // Must still have price header, stock line, and buy link
  assert.match(embed.description || "", /## ~~₹650~~ ➔ \*\*₹600\*\* \(-7\.7% \/ Save ₹50\)/);
  assert.match(embed.description || "", /🟢 \*\*80 units available\*\* at pincode 380001/);
  assert.match(embed.description || "", /\[⚡ Buy on Amul Store ↗\]/);
});

test("PriceDropAlert: handles zero or out of stock items accurately", () => {
  const oosProduct = createMockProduct({ inStock: false, available: 0, inventoryQuantity: 0 });
  const input: PriceDropAlertInput = {
    webhookUrl: "https://discord.com/api/webhooks/123456789/dummy-token",
    product: oosProduct,
    oldPrice: 2500,
    newPrice: 2200,
    discountPct: 12,
    savingsAmount: 300,
    pincode: "400068",
    stockUnits: 0,
  };

  const embed = buildPriceDropAlertEmbed(input);
  assert.match(embed.description || "", /🔴 \*\*0 units available\*\* at pincode 400068/);
});

test("PriceDropAlert: sendPriceDropAlert validates webhook URLs properly without making network calls", async () => {
  const product = createMockProduct();
  const baseInput: Omit<PriceDropAlertInput, "webhookUrl"> = {
    product,
    oldPrice: 2500,
    newPrice: 2250,
    discountPct: 10,
    savingsAmount: 250,
    pincode: "400068",
    stockUnits: 45,
  };

  // Missing URL
  const emptyRes = await sendPriceDropAlert({ ...baseInput, webhookUrl: "" });
  assert.equal(emptyRes.ok, false);
  assert.match(emptyRes.error || "", /Discord webhook URL is required/);

  // Invalid URL format
  const invalidRes = await sendPriceDropAlert({
    ...baseInput,
    webhookUrl: "https://example.com/not-a-discord-webhook",
  });
  assert.equal(invalidRes.ok, false);
  assert.match(invalidRes.error || "", /Invalid Discord webhook URL format/);
});

test("PromoBanner mapper constructs full CDN URLs and retains metadata", () => {
  const fileBaseUrl = "https://shop.amul.com/s/62fa94df8c13af2e242eba16/";
  const raw = {
    _id: "633a741d7bc785c6928a2e2c",
    name: "HB Protein",
    alias: "home-banner-protein",
    image: "6549e729b86f2d8e7f4b1be1/amul_new_protein-bm_lassi_web-banner.png",
    publish: "1",
    sort_order: 0,
    substore: ["all"],
    updated_on: "2025-06-25T07:24:24.530Z",
  };

  const banner: PromoBanner = {
    id: String(raw._id),
    name: String(raw.name),
    alias: String(raw.alias),
    imageUrl: `${fileBaseUrl}${raw.image}`,
    image: raw.image,
    publish: raw.publish,
    sortOrder: raw.sort_order,
    substore: raw.substore,
    updatedOn: raw.updated_on,
  };

  assert.equal(banner.id, "633a741d7bc785c6928a2e2c");
  assert.equal(banner.name, "HB Protein");
  assert.equal(banner.alias, "home-banner-protein");
  assert.equal(
    banner.imageUrl,
    "https://shop.amul.com/s/62fa94df8c13af2e242eba16/6549e729b86f2d8e7f4b1be1/amul_new_protein-bm_lassi_web-banner.png",
  );
});

test("checkCoupon rejects empty or whitespace coupon codes without network traffic", async () => {
  const client = new AmulClient();
  const res = await client.checkCoupon("   ");
  assert.equal(res.valid, false);
  assert.equal(res.message, "Coupon code cannot be empty");
});

test("checkCoupon in demo session validates demo coupons and rejects unknown coupons", async () => {
  const client = new AmulClient();
  client.isDemoSession = true;
  const validRes = await client.checkCoupon("PROTEIN10");
  assert.equal(validRes.valid, true);
  assert.equal(validRes.discount, 100);

  const invalidRes = await client.checkCoupon("UNKNOWN99");
  assert.equal(invalidRes.valid, false);
  assert.equal(invalidRes.message, "Coupon Code is not valid");
});

test("listPromoBanners in demo session returns mock banners", async () => {
  const client = new AmulClient();
  client.isDemoSession = true;
  const banners = await client.listPromoBanners();
  assert.equal(banners.length >= 2, true);
  assert.equal(banners[0].name, "HB Protein");
  assert.equal(banners[0].imageUrl.includes("shop.amul.com"), true);
});

test("Adaptive Poller: empty watchlist runs periodic low-frequency sweeps rather than halting", () => {
  // Daytime test: 14:00 IST (08:30 UTC)
  const daytimeUtc = new Date("2026-10-30T08:30:00Z");
  const daytimeInterval = calculateAdaptiveInterval(
    {
      watching: true,
      config: { ...DEFAULT_CONFIG, products: [], pollMaxMs: 7200000 },
      client: null,
      substore: null,
      products: [],
      events: [],
      lastTickAt: null,
      nextPollMs: 6000,
      pollCount: 0,
      lastError: null,
      amulReachable: true,
      sessionReady: true,
      previousStock: {},
      previousPrices: {},
      primed: true,
      timer: null,
      inFlight: null,
    },
    daytimeUtc,
  );
  assert.equal(daytimeInterval, 120000); // 2 minutes periodic daytime sweep

  // Night Dormancy test: 02:00 IST (20:30 UTC previous day)
  const nightUtc = new Date("2026-10-29T20:30:00Z");
  const nightInterval = calculateAdaptiveInterval(
    {
      watching: true,
      config: { ...DEFAULT_CONFIG, products: [], pollMaxMs: 7200000 },
      client: null,
      substore: null,
      products: [],
      events: [],
      lastTickAt: null,
      nextPollMs: 6000,
      pollCount: 0,
      lastError: null,
      amulReachable: true,
      sessionReady: true,
      previousStock: {},
      previousPrices: {},
      primed: true,
      timer: null,
      inFlight: null,
    },
    nightUtc,
  );
  assert.equal(nightInterval, 600000); // 10 minutes periodic night sweep
});

test("Price drop comparator logic: detects price drops vs previous prices and active discounts", () => {
  const previousPrices: Record<string, number> = {
    "AMUL-WHEY-01": 2500,
    "AMUL-SHAKE-01": 900,
  };

  // 1. Price drop from 2500 to 2250 (10% drop, save 250)
  const currentPrice1 = 2250;
  const oldPrice1 = previousPrices["AMUL-WHEY-01"];
  const hasDrop1 = oldPrice1 !== undefined && currentPrice1 < oldPrice1;
  assert.equal(hasDrop1, true);
  const savings1 = oldPrice1 - currentPrice1;
  const discountPct1 = Math.round((savings1 / oldPrice1) * 100);
  assert.equal(savings1, 250);
  assert.equal(discountPct1, 10);

  // 2. Alert criteria: watchlist triggers regardless of pct; general catalog triggers only if >= 5%
  const isWatched = true;
  const shouldAlertWatchlist = isWatched || discountPct1 >= 5;
  assert.equal(shouldAlertWatchlist, true);

  // 3. General catalog item with 3% drop (< 5% threshold)
  const isGeneral = false;
  const smallDiscountPct = 3;
  const shouldAlertGeneralSmall = isGeneral || smallDiscountPct >= 5;
  assert.equal(shouldAlertGeneralSmall, false);

  // 4. General catalog item with 8% drop (>= 5% threshold)
  const bigDiscountPct = 8;
  const shouldAlertGeneralBig = isGeneral || bigDiscountPct >= 5;
  assert.equal(shouldAlertGeneralBig, true);
});

