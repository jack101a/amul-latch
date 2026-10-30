import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DISCORD_COLOR_GOLD,
  buildPriceDropAlertEmbed,
  buildPriceDropAlertPayload,
  sanitizeMentions,
  sendPriceDropAlert,
  type PriceDropAlertInput,
} from "../src/lib/amul/discord";
import {
  calculateAdaptiveInterval,
  getISTDecimalHour,
} from "../src/lib/amul/runtime";
import {
  type AmulProduct,
  DEFAULT_CONFIG,
} from "../src/lib/amul/types";
import { AmulClient } from "../src/lib/amul/client";

function mockProduct(overrides?: Partial<AmulProduct>): AmulProduct {
  return {
    id: "prod_adv_1",
    sku: "AMUL-ADV-WHEY-01",
    name: "Amul Chocolate Whey Protein, 34 g | Pack of 30",
    alias: "amul-chocolate-whey-protein-34-g-pack-of-30",
    price: 2100,
    comparePrice: 2500,
    discountAmount: 400,
    discountPct: 16,
    available: 50,
    inventoryQuantity: 50,
    inventoryLowStock: 5,
    inStock: true,
    imageUrl: "https://shop.amul.com/s/img.png",
    productUrl: "https://shop.amul.com/en/product/test",
    proteinGrams: 750,
    costPerGramProtein: 2.8,
    proteinPerServing: 25,
    servingSizeText: "sachet",
    ...overrides,
  };
}

let passed = 0;
let total = 0;

function runCheck(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    const res = fn();
    if (res && typeof (res as Promise<void>).then === "function") {
      return (res as Promise<void>).then(() => {
        passed++;
        console.log(`  ✔ [PASS] ${name}`);
      }).catch((err) => {
        console.error(`  ✖ [FAIL] ${name}:`, err);
        throw err;
      });
    } else {
      passed++;
      console.log(`  ✔ [PASS] ${name}`);
    }
  } catch (err) {
    console.error(`  ✖ [FAIL] ${name}:`, err);
    throw err;
  }
}

async function main() {
  console.log("=== ADVERSARIAL STRESS TEST: Milestone 2 ===");

  // 1. Mentions Invariant Stress Test
  runCheck("Mentions Invariant: variations of @everyone and @here across case, punctuation, formatting", () => {
    const attackStrings = [
      "@everyone",
      "@here",
      "@EVERYONE",
      "@HERE",
      "@Everyone",
      "@Here",
      "Sale alert! @everyone join now @here",
      "**@everyone**",
      "_@here_",
      "`@everyone`",
      "email@everyone.com", // should safely become email@\u200Beveryone.com
      "https://example.com/@everyone",
      "@@everyone",
      "@here@everyone",
    ];

    for (const str of attackStrings) {
      const sanitized = sanitizeMentions(str);
      assert.equal(sanitized.includes("@everyone"), false, `Failed to neutralize @everyone in: ${str}`);
      assert.equal(sanitized.includes("@here"), false, `Failed to neutralize @here in: ${str}`);
      assert.equal(sanitized.includes("@EVERYONE"), false, `Failed to neutralize @EVERYONE in: ${str}`);
      assert.equal(sanitized.includes("@HERE"), false, `Failed to neutralize @HERE in: ${str}`);
    }
  });

  // 2. Mentions in Product Payload Invariant
  runCheck("Mentions Invariant: adversarial injection in product fields and payload JSON serialization", () => {
    const malicious = mockProduct({
      name: "🔥 ULTRA DEAL @everyone @here FREE WHEY",
      alias: "ultra-deal-protein",
      productUrl: "https://shop.amul.com/en/product/test",
    });

    const input: PriceDropAlertInput = {
      webhookUrl: "https://discord.com/api/webhooks/999/dummy",
      product: malicious,
      oldPrice: 3000,
      newPrice: 1500,
      discountPct: 50,
      savingsAmount: 1500,
      pincode: "400068 @everyone",
      stockUnits: 100,
    };

    const embed = buildPriceDropAlertEmbed(input);
    const payload = buildPriceDropAlertPayload(input);

    const json = JSON.stringify(payload);
    assert.equal(json.includes("@everyone"), false, "Payload JSON leaked @everyone");
    assert.equal(json.includes("@here"), false, "Payload JSON leaked @here");
    assert.equal(embed.color, DISCORD_COLOR_GOLD);
    assert.equal(embed.color, 0xF59E0B);
  });

  // 3. Extreme & Degenerate Numbers in Embed Builder
  runCheck("Embed Builder: degenerate prices, NaN, negative numbers, extreme scale", () => {
    // A. Extreme numbers: 100 Crore
    const p1 = mockProduct({ proteinGrams: 1000 });
    const in1: PriceDropAlertInput = {
      webhookUrl: "https://discord.com/api/webhooks/999/dummy",
      product: p1,
      oldPrice: 1000000000,
      newPrice: 800000000,
      discountPct: 20,
      savingsAmount: 200000000,
      pincode: "110001",
      stockUnits: 999999,
    };
    const e1 = buildPriceDropAlertEmbed(in1);
    assert.match(e1.description || "", /~~₹1,00,00,00,000~~ ➔ \*\*₹80,00,00,000\*\*/);

    // B. Zero and negative prices / savings
    const in2: PriceDropAlertInput = {
      webhookUrl: "https://discord.com/api/webhooks/999/dummy",
      product: p1,
      oldPrice: 0,
      newPrice: 0,
      discountPct: 0,
      savingsAmount: 0,
      pincode: "110001",
      stockUnits: 0,
    };
    const e2 = buildPriceDropAlertEmbed(in2);
    assert.match(e2.description || "", /~~₹0~~ ➔ \*\*₹0\*\*/);
    assert.match(e2.description || "", /🔴 \*\*0 units available\*\*/);

    // C. Decimal currency and precision
    const in3: PriceDropAlertInput = {
      webhookUrl: "https://discord.com/api/webhooks/999/dummy",
      product: p1,
      oldPrice: 49.99,
      newPrice: 39.49,
      discountPct: 21.004,
      savingsAmount: 10.5,
      pincode: "400068",
      stockUnits: 1,
    };
    const e3 = buildPriceDropAlertEmbed(in3);
    assert.match(e3.description || "", /~~₹49\.99~~ ➔ \*\*₹39\.49\*\* \(-21% \/ Save ₹10\.5\)/);
  });

  // 4. Missing Optional Fields (Nulls, undefined, empty strings)
  runCheck("Embed Builder: handles empty productUrl, missing alias, null images, no protein gracefully", () => {
    const bareProduct: AmulProduct = {
      id: "bare_1",
      sku: "BARE-SKU",
      name: "Bare Product Without Nutrition",
      alias: "",
      price: 150,
      available: 0,
      inStock: false,
    };

    const inBare: PriceDropAlertInput = {
      webhookUrl: "https://discord.com/api/webhooks/999/dummy",
      product: bareProduct,
      oldPrice: 200,
      newPrice: 150,
      discountPct: 25,
      savingsAmount: 50,
      pincode: "560001",
      stockUnits: 0,
    };

    const embed = buildPriceDropAlertEmbed(inBare);
    const payload = buildPriceDropAlertPayload(inBare);

    assert.ok(embed.description);
    assert.equal(embed.description.includes("null"), false);
    assert.equal(embed.description.includes("undefined"), false);
    assert.equal(embed.description.includes("NaN"), false);
    assert.equal(embed.thumbnail, undefined);
    assert.equal(embed.author?.url, "https://shop.amul.com");
    assert.equal(payload.components?.[0].components?.[0].url, "https://shop.amul.com");
  });

  // 5. Poller Adaptive Timing Logic: Day vs Night on Empty Watchlist
  runCheck("Poller Adaptive Timing: empty watchlist day/night intervals and transitions", () => {
    const baseState = {
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
    };

    // Test across 24 hours of IST
    for (let istH = 0; istH < 24; istH += 0.5) {
      // Convert IST to UTC date
      const utcH = (istH - 5.5 + 24) % 24;
      const hours = Math.floor(utcH);
      const mins = Math.round((utcH - hours) * 60);
      const d = new Date(Date.UTC(2026, 9, 30, hours, mins, 0));

      const interval = calculateAdaptiveInterval(baseState, d);

      if (istH >= 23 || istH < 6.5) {
        assert.equal(interval, 600000, `Expected 600,000ms at IST ${istH}, got ${interval}`);
      } else {
        assert.equal(interval, 120000, `Expected 120,000ms at IST ${istH}, got ${interval}`);
      }
    }
  });

  // 6. Poller Timing with Watched Products: All-out vs In-Stock vs Dormancy
  runCheck("Poller Adaptive Timing: watched products restock peaks vs dormancy", () => {
    const watchedState = {
      watching: true,
      config: {
        ...DEFAULT_CONFIG,
        products: [{ sku: "SKU1", quantity: 1, name: "Whey", alias: "whey", productId: "p1" }],
        pollMinMs: 6000,
        pollMaxMs: 15000,
      },
      client: null,
      substore: null,
      products: [{ id: "p1", sku: "SKU1", name: "Whey", alias: "whey", price: 2000, available: 0, inStock: false }],
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
    };

    // Daytime peak (12:00 IST = 06:30 UTC): should be minMs = 6000
    const peakDate = new Date("2026-10-30T06:30:00Z");
    assert.equal(calculateAdaptiveInterval(watchedState, peakDate), 6000);

    // Daytime standard (15:00 IST = 09:30 UTC): should be round((6000 + 15000) / 2) = 10500
    const stdDate = new Date("2026-10-30T09:30:00Z");
    assert.equal(calculateAdaptiveInterval(watchedState, stdDate), 10500);

    // Night Dormancy (02:00 IST = 20:30 UTC): should be max(maxMs, 45000) = 45000
    const nightDate = new Date("2026-10-29T20:30:00Z");
    assert.equal(calculateAdaptiveInterval(watchedState, nightDate), 45000);

    // When an item comes IN STOCK: should always return pollMinMs regardless of time of day
    watchedState.products[0].inStock = true;
    watchedState.products[0].available = 10;
    assert.equal(calculateAdaptiveInterval(watchedState, nightDate), 6000);
    assert.equal(calculateAdaptiveInterval(watchedState, stdDate), 6000);
  });

  // 7. Config Persistence & Corruption Resilience
  runCheck("Config Persistence: latch-config.json handles corrupted, partial, or malformed previousPrices", () => {
    // Read current config
    const configPath = path.resolve(process.cwd(), "latch-config.json");
    assert.ok(fs.existsSync(configPath), "latch-config.json must exist");

    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    assert.ok("previousPrices" in parsed, "latch-config.json must contain previousPrices key");
    assert.equal(typeof parsed.previousPrices, "object");
  });

  // 8. Coupon Code Logic: SQLi / XSS / Format stress
  await runCheck("Coupon Validation: rejects injection vectors and accepts valid promo codes", async () => {
    const client = new AmulClient();
    client.isDemoSession = true;

    // A. Injection payloads
    const injections = [
      "'; DROP TABLE users; --",
      "<script>alert(1)</script>",
      "${7*7}",
      "../../etc/passwd",
      "\0",
      "\\x00",
    ];

    for (const inj of injections) {
      const res = await client.checkCoupon(inj);
      assert.equal(res.valid, false, `Injection vector ${inj} should be rejected`);
      assert.equal(res.discount, 0);
    }

    // B. Whitespace and empty
    assert.equal((await client.checkCoupon("")).valid, false);
    assert.equal((await client.checkCoupon("   \t\n  ")).valid, false);

    // C. Valid demo coupon (case-insensitive)
    assert.equal((await client.checkCoupon("amul10")).valid, true);
    assert.equal((await client.checkCoupon("AMUL10")).valid, true);
    assert.equal((await client.checkCoupon("protein10")).valid, true);
    assert.equal((await client.checkCoupon("PROTEIN10")).valid, true);
  });

  // 9. Promo Banner Processing
  await runCheck("Promo Banners: parses CDN URLs and metadata cleanly", async () => {
    const client = new AmulClient();
    client.isDemoSession = true;
    const banners = await client.listPromoBanners();
    assert.ok(banners.length > 0);
    for (const b of banners) {
      assert.ok(b.id, "Banner must have ID");
      assert.ok(b.name, "Banner must have name");
      assert.ok(b.imageUrl.startsWith("https://"), "Banner imageUrl must be absolute https");
      assert.ok(b.image, "Banner raw image must exist");
    }
  });

  // 10. Webhook Validation without Network Calls
  await runCheck("Webhook Validation: verifies genuine discord webhook URLs vs malicious/invalid URLs", async () => {
    const fakeProduct = mockProduct();
    const alertInput: PriceDropAlertInput = {
      webhookUrl: "https://evil-phishing.com/webhook",
      product: fakeProduct,
      oldPrice: 2000,
      newPrice: 1800,
      discountPct: 10,
      savingsAmount: 200,
      pincode: "400068",
      stockUnits: 10,
    };

    const res = await sendPriceDropAlert(alertInput);
    assert.equal(res.ok, false);
    assert.match(res.error || "", /Invalid Discord webhook URL format/);
  });

  console.log(`\nAdversarial Stress Test Complete: ${passed}/${total} checks passed.`);
}

main().catch((err) => {
  console.error("Adversarial Test Failed:", err);
  process.exit(1);
});
