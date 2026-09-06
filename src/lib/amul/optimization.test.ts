import test from "node:test";
import assert from "node:assert/strict";
import {
  extractProteinGrams,
  calculateProteinCostPerGram,
  DEFAULT_CONFIG,
  type AppConfig,
  type TrackedProduct,
  type AmulProduct,
} from "./types.ts";
import { getISTDecimalHour, calculateAdaptiveInterval } from "./runtime.ts";

test("Protein Economics: extraction of protein grams", () => {
  assert.equal(extractProteinGrams("Amul High Protein Buttermilk 15g"), 15);
  assert.equal(extractProteinGrams("Amul High Protein Lassi 15g Rose"), 15);
  assert.equal(extractProteinGrams("Amul High Protein Whey Shake 25g (Pack of 30)"), 25);
  assert.equal(extractProteinGrams("Amul Whey Protein 30 Sachets 24 g"), 24);
  assert.equal(extractProteinGrams("High Protein Paneer 70g"), 70);
  assert.equal(extractProteinGrams("Amul Plain Chaas 200ml"), 15);
  assert.equal(extractProteinGrams("Generic Ice Cream"), null);
});

test("Protein Economics: ₹/gram cost calculation", () => {
  // ₹40 for 15g = 2.67
  assert.equal(calculateProteinCostPerGram(40, 15), 2.67);
  // ₹50 for 25g = 2.00
  assert.equal(calculateProteinCostPerGram(50, 25), 2);
  // ₹150 for 70g = 2.14
  assert.equal(calculateProteinCostPerGram(150, 70), 2.14);
  // Invalid inputs
  assert.equal(calculateProteinCostPerGram(0, 15), null);
  assert.equal(calculateProteinCostPerGram(40, null), null);
  assert.equal(calculateProteinCostPerGram(40, -5), null);
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

  // 3. In-stock with autoOrder at night: MUST still poll at pollMinMs
  const inStockAutoOrderInterval = calculateAdaptiveInterval(
    {
      config: { ...baseConfig, autoOrder: true },
      products: inStockCatalog,
      checkout: null,
    } as any,
    nightDate
  );
  assert.equal(inStockAutoOrderInterval, 6000);

  // 4. Active Checkout: MUST poll at max(pollMinMs, 5000) = 6000
  const runningCheckoutInterval = calculateAdaptiveInterval(
    {
      config: baseConfig,
      products: outOfStockCatalog,
      checkout: { status: "running" },
    } as any,
    nightDate
  );
  assert.equal(runningCheckoutInterval, 6000);
});
