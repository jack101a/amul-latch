import test from "node:test";
import assert from "node:assert/strict";
import { formatProteinYield, extractProteinGrams, calculateProteinCostPerGram } from "./types.ts";

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
