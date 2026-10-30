import test from "node:test";
import assert from "node:assert/strict";
import {
  extractProteinGrams,
  extractPackMultiplier,
  calculateProteinCostPerGram,
  DEFAULT_CONFIG,
  type AppConfig,
  type TrackedProduct,
  type AmulProduct,
} from "./types.ts";
import { AmulClient } from "./client.ts";
import { getISTDecimalHour, calculateAdaptiveInterval, getConfig, applyConfig } from "./runtime.ts";

test("Protein Economics: extraction of pack multiplier", () => {
  assert.equal(extractPackMultiplier("Amul High Protein Buttermilk, 200 ml | Pack of 30"), 30);
  assert.equal(extractPackMultiplier("Amul Chocolate Whey Protein Gift Pack, 34 g | Pack of 10 sachets"), 10);
  assert.equal(extractPackMultiplier("Amul Whey Protein 30 Sachets 24 g"), 30);
  assert.equal(extractPackMultiplier("Amul Kool Protein Milkshake | Chocolate, 180 ml | Pack of 8"), 8);
  assert.equal(extractPackMultiplier("Single Buttermilk 200 ml"), 1);
});

test("Protein Economics: total protein grams calculation", () => {
  // 15g * 30 = 450g total
  assert.equal(extractProteinGrams("Amul High Protein Buttermilk, 200 ml | Pack of 30"), 450);
  // 25g * 10 = 250g total
  assert.equal(extractProteinGrams("Amul Chocolate Whey Protein Gift Pack, 34 g | Pack of 10 sachets"), 250);
  // 24g * 30 = 720g total
  assert.equal(extractProteinGrams("Amul Whey Protein 30 Sachets 24 g"), 720);
  // 20g * 30 = 600g total (Amul High Protein Blueberry Shake)
  assert.equal(extractProteinGrams("Amul High Protein Blueberry Shake, 200 mL | Pack of 30"), 600);
  // Single pack 15g
  assert.equal(extractProteinGrams("Amul High Protein Buttermilk 15g"), 15);
  // Generic non-protein
  assert.equal(extractProteinGrams("Generic Ice Cream"), null);
});

test("Protein Economics: ₹/gram cost calculation", () => {
  // ₹900 for 450g protein = ₹2.00/g
  assert.equal(calculateProteinCostPerGram(900, 450), 2.0);
  // ₹920 for 250g protein = ₹3.68/g
  assert.equal(calculateProteinCostPerGram(920, 250), 3.68);
  // ₹1200 for 300g protein = ₹4.00/g
  assert.equal(calculateProteinCostPerGram(1200, 300), 4.0);
  // Invalid inputs
  assert.equal(calculateProteinCostPerGram(0, 15), null);
  assert.equal(calculateProteinCostPerGram(40, null), null);
});

test("Circadian Adaptive Polling: IST decimal hour calculation", () => {
  // 04:30 UTC -> 10:00 IST (10.0)
  const d1 = new Date("2026-09-06T04:30:00Z");
  assert.equal(Math.round(getISTDecimalHour(d1) * 10) / 10, 10);

  // 13:00 UTC -> 18:30 IST (18.5)
  const d2 = new Date("2026-09-06T13:00:00Z");
  assert.equal(Math.round(getISTDecimalHour(d2) * 10) / 10, 18.5);

  // 18:00 UTC -> 23:30 IST (23.5)
  const d3 = new Date("2026-09-06T18:00:00Z");
  assert.equal(Math.round(getISTDecimalHour(d3) * 10) / 10, 23.5);

  // 22:00 UTC -> 03:30 IST (3.5)
  const d4 = new Date("2026-09-06T22:00:00Z");
  assert.equal(Math.round(getISTDecimalHour(d4) * 10) / 10, 3.5);
});

test("Circadian Adaptive Polling: interval scaling across restock and dormancy windows", () => {
  const trackedProduct: TrackedProduct = {
    sku: "TEST-SKU",
    quantity: 1,
    name: "Amul Protein Lassi",
    alias: "amul-protein-lassi",
    productId: "prod_1",
  };

  const outOfStockCatalog: AmulProduct[] = [
    {
      id: "prod_1",
      sku: "TEST-SKU",
      name: "Amul Protein Lassi",
      alias: "amul-protein-lassi",
      price: 40,
      available: 0,
      inventoryQuantity: 0,
      inventoryLowStock: 0,
      inStock: false,
      imageUrl: null,
      productUrl: "https://shop.amul.com/test",
    },
  ];

  const inStockCatalog: AmulProduct[] = [
    {
      ...outOfStockCatalog[0],
      available: 10,
      inventoryQuantity: 10,
      inStock: true,
    },
  ];

  const baseConfig: AppConfig = {
    ...DEFAULT_CONFIG,
    pincode: "560001",
    products: [trackedProduct],
    pollMinMs: 6000,
    pollMaxMs: 40000,
  };

  // 1. Night Dormancy (02:00 IST = 20:30 UTC previous day): should back off (>= 40000ms)
  const nightDate = new Date("2026-09-05T20:30:00Z");
  const nightInterval = calculateAdaptiveInterval(
    {
      config: baseConfig,
      products: outOfStockCatalog,
      checkout: null,
    } as any,
    nightDate
  );
  assert.ok(
    nightInterval >= 40000,
    `Night interval should be >= 40000, got ${nightInterval}`
  );

  // 2. Daytime Peak (11:00 IST = 05:30 UTC): should be aggressive (<= 8000ms)
  const peakDate = new Date("2026-09-06T05:30:00Z");
  const peakInterval = calculateAdaptiveInterval(
    {
      config: baseConfig,
      products: outOfStockCatalog,
      checkout: null,
    } as any,
    peakDate
  );
  assert.ok(
    peakInterval <= 8000,
    `Peak interval should be <= 8000, got ${peakInterval}`
  );

  // 3. In-stock tracked SKU at night: MUST still poll at pollMinMs (6000)
  const inStockInterval = calculateAdaptiveInterval(
    {
      config: baseConfig,
      products: inStockCatalog,
    } as any,
    nightDate
  );
  assert.equal(inStockInterval, 6000);
});

test("Config Ingestion: getConfig returns application configuration", () => {
  applyConfig({ discordWebhookUrl: "https://discord.com/api/webhooks/test/123", discordEnabled: true });
  const cfg = getConfig();
  assert.equal(cfg.discordWebhookUrl, "https://discord.com/api/webhooks/test/123");
  assert.equal(cfg.discordEnabled, true);
});

test("Session Resilience: AmulClient auto-expires stale sessions", () => {
  const client = new AmulClient();
  
  // Uninitialized client has no session
  assert.equal(client.hasSession(), false);

  // Demo session is always considered valid
  client.isDemoSession = true;
  assert.equal(client.hasSession(), true);
  client.isDemoSession = false;

  // Stale session (created 3 hours ago) should be treated as expired
  client.importCookies("jsessionid=test_cookie_123");
  client["tid"] = "sample_tid";
  client["sessionCreatedAt"] = Date.now() - 3 * 60 * 60 * 1000;
  assert.equal(client.hasSession(), false, "Session older than 2 hours must expire");

  // Fresh session (created 5 minutes ago) should be valid
  client["sessionCreatedAt"] = Date.now() - 5 * 60 * 1000;
  assert.equal(client.hasSession(), true, "Fresh session within 2 hours must be valid");
});
