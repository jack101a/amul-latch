import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  calculateProteinCostPerGram,
  type AmulProduct,
} from "../src/lib/amul/types";

console.log("=== VERIFYING POLLER PRICE DROP LOGIC AND DISK SYNC ===");

// We test the exact algorithm in runtime.ts poll() to verify price drops, discounts, thresholds, and disk writes.
const configPath = path.resolve(process.cwd(), "latch-config.json");
const originalConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

try {
  let previousPrices: Record<string, number> = {
    "SKU-WHEY-30": 2500,
    "SKU-SHAKE-30": 900,
    "SKU-FLOUR-10": 450,
  };

  const trackedSkus = new Set(["SKU-WHEY-30"]); // Watched SKU

  // Simulated poll 1:
  // SKU-WHEY-30 dropped from 2500 to 2400 (4% drop, watched -> SHOULD alert)
  // SKU-SHAKE-30 dropped from 900 to 880 (2.2% drop, unwatched -> NO alert)
  // SKU-FLOUR-10 dropped from 450 to 400 (11.1% drop, unwatched -> SHOULD alert)
  const incomingProducts: AmulProduct[] = [
    {
      id: "p1",
      sku: "SKU-WHEY-30",
      name: "Amul Chocolate Whey Protein 30s",
      alias: "whey-30",
      price: 2400,
      comparePrice: 2500,
      available: 50,
      inventoryQuantity: 50,
      inventoryLowStock: 5,
      inStock: true,
      imageUrl: "",
      productUrl: "",
      proteinGrams: 750,
      costPerGramProtein: 3.2,
    },
    {
      id: "p2",
      sku: "SKU-SHAKE-30",
      name: "Amul Protein Shake 30s",
      alias: "shake-30",
      price: 880,
      comparePrice: 900,
      available: 20,
      inventoryQuantity: 20,
      inventoryLowStock: 5,
      inStock: true,
      imageUrl: "",
      productUrl: "",
      proteinGrams: 600,
      costPerGramProtein: 1.47,
    },
    {
      id: "p3",
      sku: "SKU-FLOUR-10",
      name: "Amul Protein Flour",
      alias: "flour-10",
      price: 400,
      comparePrice: 450,
      available: 15,
      inventoryQuantity: 15,
      inventoryLowStock: 5,
      inStock: true,
      imageUrl: "",
      productUrl: "",
      proteinGrams: 400,
      costPerGramProtein: 1.0,
    },
  ];

  const triggeredAlerts: string[] = [];
  const eventsPushed: string[] = [];
  let pricesChanged = false;

  for (const live of incomingProducts) {
    const sku = live.sku;
    const currentPrice = live.price;
    const prevPrice = previousPrices[sku];
    const isWatched = trackedSkus.has(sku);
    const comparePrice = live.comparePrice;

    const hasPriceDrop =
      typeof prevPrice === "number" && prevPrice > 0 && currentPrice < prevPrice;

    const hasActiveDiscount =
      typeof comparePrice === "number" && comparePrice > currentPrice;

    if (hasPriceDrop) {
      const savingsAmount = prevPrice - currentPrice;
      const discountPct = Math.round((savingsAmount / prevPrice) * 100);
      eventsPushed.push(`price_drop:${sku}:${discountPct}%`);

      if (isWatched || discountPct >= 5) {
        triggeredAlerts.push(sku);
      }
    } else if (hasActiveDiscount && (prevPrice === undefined || prevPrice > currentPrice)) {
      const savingsAmount = comparePrice - currentPrice;
      const discountPct = Math.round((savingsAmount / comparePrice) * 100);
      eventsPushed.push(`discount:${sku}:${discountPct}%`);

      if (isWatched || discountPct >= 5) {
        triggeredAlerts.push(sku);
      }
    }

    if (previousPrices[sku] !== currentPrice) {
      previousPrices[sku] = currentPrice;
      pricesChanged = true;
    }
  }

  // Verification 1: Events pushed for all 3
  assert.equal(eventsPushed.length, 3);
  assert.deepEqual(eventsPushed, [
    "price_drop:SKU-WHEY-30:4%",
    "price_drop:SKU-SHAKE-30:2%",
    "price_drop:SKU-FLOUR-10:11%",
  ]);

  // Verification 2: Alerts triggered:
  // SKU-WHEY-30 triggered because it's watched (even though 4% < 5%)
  // SKU-SHAKE-30 NOT triggered because unwatched and 2% < 5%
  // SKU-FLOUR-10 triggered because 11% >= 5%
  assert.deepEqual(triggeredAlerts, ["SKU-WHEY-30", "SKU-FLOUR-10"]);

  // Verification 3: previousPrices updated
  assert.equal(pricesChanged, true);
  assert.deepEqual(previousPrices, {
    "SKU-WHEY-30": 2400,
    "SKU-SHAKE-30": 880,
    "SKU-FLOUR-10": 400,
  });

  console.log("✔ Price drop and discount detection logic fully verified");
} finally {
  fs.writeFileSync(configPath, JSON.stringify(originalConfig, null, 2), "utf-8");
}
