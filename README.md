# 🥛 Latch — Amul Protein Restock Watcher & Assisted Checkout

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.12-blue.svg)](https://nodejs.org/)
[![Docker Compatible](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](Dockerfile)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](tsconfig.json)

**Latch** is an open-source, ultra-lightweight personal restock monitoring and assisted checkout desk built specifically for India's official Amul online store ([shop.amul.com](https://shop.amul.com)).

High-demand products in Amul’s protein catalog—such as Amul Whey Protein, High Protein Buttermilk, High Protein Lassi, and High Protein Paneer—frequently sell out within minutes of replenishment. Because Amul strictly segments inventory across regional cold-storage substores mapped to **6-digit Indian PIN codes**, Latch continuously monitors local availability, sends instant alerts, and can automatically advance orders to the final payment gate.

---

## ✨ Features

- **📍 PIN Code Substore Resolution:** Instantly resolves any 6-digit Indian PIN code to its corresponding Amul cold-storage substore (e.g. Ahmedabad, Bengaluru, Delhi NCR, Mumbai, Hyderabad) and pulls live SKU counts.
- **⚡ Ultra-Low Resource Engine:** Consumes only **~55–60 MB RAM** and **< 0.2% CPU** during 24/7 background monitoring.
- **📲 Direct Phone OTP Login:** Sign into your Amul account directly from the UI with a 1-time SMS OTP—no browser DevTools or cookie-inspecting required. Also supports 1-click Bookmarklet and manual session cookie import.
- **🔔 Restock Edge Detection:** Detects the exact millisecond a watched SKU flips from `out_of_stock` to `in_stock`.
- **🛒 Assisted Checkout Pipeline:**
  - Creates a reserved cart on Amul.
  - Adds your selected SKUs and desired quantities.
  - Binds your saved account delivery address.
  - Advances checkout directly to the payment gateway (`awaiting_payment`).
- **🛡️ Strict Non-Custodial Safety Guarantee:**
  - **Latch NEVER handles, requests, or stores UPI PINs, CVVs, passwords, or bank OTPs.**
  - Checkout strictly halts at the final payment approval screen, allowing you to safely approve the transaction on your UPI app (GPay, PhonePe, Paytm, Cred).
- **📢 WhatsApp Push Alerts:** Instant restock notifications and checkout payment links pushed to your phone via CallMeBot.
- **🔒 Local-First Privacy:** All settings and tokens stay in your browser and local process memory. Zero third-party tracking.
- **🐳 100% Docker-Ready:** Ready to deploy via Docker and Docker Compose on any VPS, home lab, Synology NAS, or Raspberry Pi.

---

## 🛠️ Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [TanStack Start](https://tanstack.com/start) (`@tanstack/react-start` v1.168) full-stack SSR & type-safe Server Functions |
| **Routing** | [TanStack Router](https://tanstack.com/router) (`@tanstack/react-router` v1.170) |
| **Frontend UI** | [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [Lucide Icons](https://lucide.dev/), [Sonner](https://sonner.emilkowal.ski/) |
| **Build & Runtime** | [Vite 8](https://vite.dev/), Node.js 22+ / 24, Nitro server engine |
| **Automation** | [Playwright](https://playwright.dev/) headless Chromium for automated OTP session authentication |
| **Containerization** | Multi-stage Docker build with healthchecks and memory limits |

---

## 🚀 Getting Started

### Method 1: Docker Compose (Recommended for 24/7 Monitoring)

1. Clone the repository:
   ```bash
   git clone https://github.com/jack101a/amul-latch.git
   cd amul-latch
   ```

2. Start the container:
   ```bash
   docker compose up -d
   ```

3. Open your browser at **`http://localhost:8082`**.

---

### Method 2: Local Node.js Setup

#### Prerequisites
- **Node.js**: `>= 22.12.0` (Node 24 recommended)
- **npm**: `>= 10`

#### Steps
1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright browser dependencies:
   ```bash
   npx playwright install --with-deps chromium
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser at **`http://localhost:8082`** (or specify `PORT=8085 npm run dev`).

---

## 📖 User Guide

### 1. Load Your Delivery PIN Code
Enter your 6-digit Indian PIN code (e.g. `380009` for Ahmedabad, `560001` for Bengaluru, `110001` for Delhi) and click **Load**. Latch queries Amul's regional substore database and loads all available protein SKUs.

### 2. Choose Products to Watch
Browse the protein catalog. Click **Watch** on any SKU (Buttermilk, Blueberry Shake, Whey Sachets, High Protein Paneer, etc.) and use the `+` / `-` buttons to set your order quantity.

### 3. Connect Your Amul Account (3 Easy Methods)
Open ⚙️ **Desk settings**:
- **Option A: Phone OTP (Simplest)** — Enter your registered 10-digit mobile number, click **Send OTP**, and submit the 6-digit code received via SMS.
- **Option B: 1-Click Bookmarklet** — Drag the bookmarklet link to your browser bookmarks bar, browse to [shop.amul.com](https://shop.amul.com), and click it to auto-sync.
- **Option C: Cookie Paste** — Paste your `jsessionid` directly from your browser's cookie storage.

### 4. (Optional) Configure WhatsApp Alerts
1. Obtain your free personal API key from CallMeBot on WhatsApp.
2. In Latch **Desk settings**, toggle **WhatsApp Alerts** ON, enter your phone number (+country code) and API key, and click **Send test WhatsApp message**.

### 5. Start Watching
Click **Start watching** in the top header. The desk will enter an active polling loop, showing countdowns to the next check, tracking inventory changes, and recording restock events in the live **Activity** feed.

---

## ⚙️ Configuration Reference

Latch can be configured either through the UI or via environment variables (useful in Docker/headless setups):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8082` | HTTP port the server binds to |
| `HOST` | `0.0.0.0` | Network interface to listen on |
| `PINCODE` | `""` | Default 6-digit Indian delivery PIN code |
| `WHATSAPP_ENABLED` | `false` | Enable or disable WhatsApp notifications |
| `WHATSAPP_PHONE` | `""` | Phone number with country code (e.g. +919876543210) |
| `WHATSAPP_APIKEY` | `""` | CallMeBot personal API key |
| `POLL_MIN_MS` | `6000` | Minimum polling interval (ms) |
| `POLL_MAX_MS` | `40000` | Maximum polling interval with backoff (ms) |
| `AUTO_ORDER` | `false` | Automatically trigger checkout on restock |
| `ORDER_COOLDOWN_MS` | `2700000` | Cooldown period between repeat orders (45 min) |

---

## 🔒 Security & Safe Automation Policy

- **Zero Credential Exposure**: Latch **never** asks for, stores, or transmits UPI PINs, NetBanking passwords, or CVV codes.
- **2FA Required**: Auto-checkout intentionally halts at the `awaiting_payment` phase. The user must authorize the payment within their chosen UPI or bank application.
- **Polite Polling**: Request intervals include randomized jitter (±18%) to avoid hammering Amul's servers.

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

## ⚠️ Disclaimer

*This project is an independent open-source tool and is not affiliated, associated, authorized, endorsed by, or in any way officially connected with Gujarat Cooperative Milk Marketing Federation Ltd (GCMMF / Amul), or any of its subsidiaries or affiliates. All product names, trademarks, and registered trademarks are property of their respective owners.*
