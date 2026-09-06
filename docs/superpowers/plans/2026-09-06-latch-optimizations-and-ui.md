# Latch UI/UX Upgrades & Resource Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Latch's user experience with real-time ₹/g protein telemetry, Web Audio restock sonar alerts, and 1-click delivery pincode chips, while implementing circadian adaptive polling and keep-alive optimizations to keep resource usage ultra-lean.

**Architecture:** Frontend extensions built with React 19, Tailwind CSS v4, and Radix UI primitives, combined with synthetic oscillator sound synthesis via Web Audio API. Backend telemetry calculations and circadian polling heuristics live within `src/lib/amul/` without any new runtime dependencies.

**Tech Stack:** React 19, TanStack Start/Router, Tailwind v4, Web Audio API, TypeScript 5.7, Node 22+.

**Spec:** [DESIGN.md](file:///home/ubuntu/projects/grok/DESIGN.md)

## Global Constraints
- Maintain existing dark reserve visual tokens (`#0c0d0b` background, `#141612` card, `#6f8f6a` sage green stock accents, Fraunces serif display typography).
- Zero external audio files or asset bloat (Web Audio API synthetic oscillator only).
- Non-custodial safety boundary: Never store or request UPI PINs, CVVs, or bank passwords.
- All code must pass `npm run typecheck` with 0 errors and `npm run build` cleanly.

---

### Task 1: Protein Economics (₹/Gram Telemetry & Sorting)

**Files:**
- Modify: `src/lib/amul/types.ts`
- Modify: `src/components/latch/product-card.tsx`
- Modify: `src/components/latch/dashboard.tsx`
- Test: `scripts/test-protein-value.ts`

**Interfaces:**
- Produces: `extractProteinGrams(name: string, alias: string): number | null`
- Produces: `calculateProteinCostPerGram(price: number, grams: number | null): number | null`

- [ ] **Step 1:** Add protein extraction and cost-per-gram calculation helper functions in `src/lib/amul/types.ts`.
- [ ] **Step 2:** Update `ProductCard` to display a badge showing `₹X.XX / g protein` and a highlight tag (e.g. "Best Value" for items under ₹1.80/g).
- [ ] **Step 3:** Add "Best Value (₹/g)" sorting filter option to `src/components/latch/dashboard.tsx`.
- [ ] **Step 4:** Run typecheck and verify visually.

---

### Task 2: Web Audio Restock Sonar Chime & Settings Toggle

**Files:**
- Create: `src/lib/audio/chime.ts`
- Modify: `src/lib/amul/types.ts`
- Modify: `src/components/latch/settings-dialog.tsx`
- Modify: `src/components/latch/dashboard.tsx`

**Interfaces:**
- Produces: `playRestockChime(): void` in `src/lib/audio/chime.ts`
- Consumes: `config.soundEnabled: boolean`

- [ ] **Step 1:** Implement synthetic Web Audio API oscillator chime in `src/lib/audio/chime.ts` (two-tone warm acoustic ping, 0KB assets).
- [ ] **Step 2:** Add `soundEnabled` (default `true`) to `AppConfig` and `DEFAULT_CONFIG` in `src/lib/amul/types.ts`.
- [ ] **Step 3:** Add "Restock Audio Alert" switch with a "Test Chime" button in `SettingsDialog`.
- [ ] **Step 4:** Hook restock event in `dashboard.tsx` to trigger `playRestockChime()` when a watched SKU flips to in-stock.

---

### Task 3: Pincode & Address Quick-Switch Chips

**Files:**
- Modify: `src/components/latch/dashboard.tsx`
- Modify: `src/lib/amul/types.ts`

**Interfaces:**
- Consumes: `resolvePincode` action
- Produces: Quick-select chip buttons for standard hubs (Ahmedabad 380009, Bengaluru 560001, Delhi 110001, Mumbai 400001) plus user's verified profile address.

- [ ] **Step 1:** Add quick-switch location chips below the Pincode input in `dashboard.tsx`.
- [ ] **Step 2:** Wire chip click handler to set pincode and immediately trigger `resolvePincode`.
- [ ] **Step 3:** If user is logged in and has a saved default address, dynamically add a chip for their address pincode.
- [ ] **Step 4:** Verify responsiveness on desktop and mobile.

---

### Task 4: Circadian Adaptive Polling & Keep-Alive Optimization

**Files:**
- Modify: `src/lib/amul/runtime.ts`

**Interfaces:**
- Modifies: `nextInterval(s: RuntimeState): number`

- [ ] **Step 1:** Add circadian time-of-day awareness to `nextInterval` in `runtime.ts` (IST daytime active restock windows vs night dormancy).
- [ ] **Step 2:** Verify polling timing logic and non-blocking backoff.

---

### Task 5: End-to-End Verification, Production Build & Git Sync

**Files:**
- Test scripts & documentation
- Git commits

- [ ] **Step 1:** Run `npm run typecheck` (must pass with 0 errors).
- [ ] **Step 2:** Run `npm run build` (must compile cleanly in production).
- [ ] **Step 3:** Run Playwright browser smoke test to capture QA screenshots.
- [ ] **Step 4:** Commit all enhancements and push to GitHub (`jack101a/amul-latch`).
