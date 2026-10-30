import {
  type AmulProduct,
  formatProteinYield,
  calculateProteinCostPerGram,
  extractProteinGrams,
  productPageUrl,
} from "./types";
import { renderProductCardPng } from "./card";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  author?: { name: string; url?: string; icon_url?: string };
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

export interface DiscordComponent {
  type: number;
  components?: DiscordComponent[];
  style?: number;
  label?: string;
  url?: string;
  emoji?: { name?: string; id?: string };
}

export interface SendDiscordWebhookInput {
  webhookUrl: string;
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordComponent[];
  file?: {
    buffer: Buffer;
    filename: string;
  };
}

export interface SendDiscordWebhookResult {
  ok: boolean;
  error?: string;
}

export interface PriceDropAlertInput {
  webhookUrl: string;
  product: AmulProduct;
  oldPrice: number;
  newPrice: number;
  discountPct: number;
  savingsAmount: number;
  pincode: string;
  stockUnits: number;
}

export const DISCORD_COLOR_GOLD = 0xf59e0b;
export const DISCORD_COLOR_EMERALD = 0x10b981;

const DISCORD_WEBHOOK_REGEX =
  /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+(?:\?.*)?$/;

/**
 * Validates whether a given string is a valid Discord webhook URL.
 */
export function isValidDiscordWebhookUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return DISCORD_WEBHOOK_REGEX.test(url.trim());
}

/**
 * Sanitizes text to remove @everyone and @here mentions by injecting
 * a zero-width space after @, preventing unintended Discord server pings.
 */
export function sanitizeMentions(text: string): string {
  if (!text) return "";
  return text
    .replace(/@everyone/gi, "@\u200Beveryone")
    .replace(/@here/gi, "@\u200Bhere");
}

function formatInr(val: number): string {
  if (!Number.isFinite(val)) return "0";
  const rounded = Number.isInteger(val) ? val : Number(val.toFixed(2));
  return rounded.toLocaleString("en-IN");
}

function formatDiscountPct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0";
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(1)));
}

/**
 * Constructs the high-priority Discord embed for a price drop or active discount.
 */
export function buildPriceDropAlertEmbed(input: PriceDropAlertInput): DiscordEmbed {
  const shopUrl =
    input.product.productUrl ||
    (input.product.alias ? productPageUrl(input.product.alias) : "https://shop.amul.com");

  const oldPriceFormatted = formatInr(input.oldPrice);
  const newPriceFormatted = formatInr(input.newPrice);
  const savingsFormatted = formatInr(input.savingsAmount);
  const discountLabel =
    input.discountPct > 0
      ? `-${formatDiscountPct(input.discountPct)}%`
      : `${formatDiscountPct(input.discountPct)}%`;

  const header = `## ~~₹${oldPriceFormatted}~~ ➔ **₹${newPriceFormatted}** (${discountLabel} / Save ₹${savingsFormatted})`;

  const proteinGrams =
    input.product.proteinGrams ??
    extractProteinGrams(input.product.name, input.product.alias);

  const costPerGram = calculateProteinCostPerGram(input.newPrice, proteinGrams);
  const yieldStr = formatProteinYield(
    input.product.name,
    input.product.alias,
    proteinGrams,
  );

  let valueLine: string | null = null;
  if (costPerGram !== null && yieldStr) {
    valueLine = `⚡ **₹${costPerGram}/g**  •  💪 **${yieldStr}**`;
  } else if (costPerGram !== null) {
    valueLine = `⚡ **₹${costPerGram}/g**`;
  } else if (yieldStr) {
    valueLine = `💪 **${yieldStr}**`;
  }

  const stockFormatted = formatInr(input.stockUnits);
  const stockLine =
    input.stockUnits > 0
      ? `🟢 **${stockFormatted} units available** at pincode ${sanitizeMentions(input.pincode)}`
      : `🔴 **0 units available** at pincode ${sanitizeMentions(input.pincode)}`;

  const descLines: string[] = [header, ""];
  if (valueLine) {
    descLines.push(valueLine, "");
  }
  descLines.push(stockLine, "", `[⚡ Buy on Amul Store ↗](${shopUrl})`);

  const description = sanitizeMentions(descLines.join("\n"));
  const authorName = sanitizeMentions(input.product.name);

  const embed: DiscordEmbed = {
    author: {
      name: authorName,
      icon_url: input.product.imageUrl || undefined,
      url: shopUrl,
    },
    color: DISCORD_COLOR_GOLD,
    description,
    footer: {
      text: "Latch Amul Radar • Price Drop Alert",
    },
    timestamp: new Date().toISOString(),
  };

  if (input.product.imageUrl) {
    embed.thumbnail = { url: input.product.imageUrl };
  }

  return embed;
}

/**
 * Builds the full Discord webhook payload including rich embed and ActionRow link button.
 */
export function buildPriceDropAlertPayload(input: PriceDropAlertInput): SendDiscordWebhookInput {
  const shopUrl =
    input.product.productUrl ||
    (input.product.alias ? productPageUrl(input.product.alias) : "https://shop.amul.com");

  const embed = buildPriceDropAlertEmbed(input);

  return {
    webhookUrl: input.webhookUrl,
    username: "⚡ Latch Amul Radar",
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "⚡ Buy on Amul Store ↗",
            url: shopUrl,
          },
        ],
      },
    ],
  };
}

/**
 * Sends a message, embeds, or files to a Discord webhook endpoint.
 */
export async function sendDiscordWebhook(
  input: SendDiscordWebhookInput
): Promise<SendDiscordWebhookResult> {
  const url = input.webhookUrl.trim();

  if (!url) {
    return { ok: false, error: "Discord webhook URL is required" };
  }

  if (!isValidDiscordWebhookUrl(url)) {
    return {
      ok: false,
      error: "Invalid Discord webhook URL format. It should look like: https://discord.com/api/webhooks/123.../abc...",
    };
  }

  const payload: Record<string, unknown> = {
    username: input.username || "⚡ Latch Amul Radar",
  };
  if (input.avatar_url) payload.avatar_url = input.avatar_url;
  if (input.content) payload.content = sanitizeMentions(input.content);
  if (input.embeds && input.embeds.length > 0) {
    payload.embeds = input.embeds;
  }
  if (input.components && input.components.length > 0) {
    payload.components = input.components;
  }

  try {
    let res: Response;

    if (input.file) {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(input.file.buffer)], { type: "image/png" });
      formData.append("files[0]", blob, input.file.filename);
      formData.append("payload_json", JSON.stringify(payload));

      res = await fetch(url, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(15000),
      });
    } else {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
    }

    if (res.status === 204 || res.status === 200) {
      return { ok: true };
    }

    const errorBody = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Discord responded with HTTP ${res.status}${errorBody ? `: ${errorBody.slice(0, 150)}` : ""}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to connect to Discord: ${msg}`,
    };
  }
}

/**
 * Sends a high-priority Discord alert embed for a price drop or active discount.
 * Formats header with strikethrough old price, updated protein cost/g, stock line,
 * and maintains the strict zero @everyone or @here mentions invariant.
 */
export async function sendPriceDropAlert(
  input: PriceDropAlertInput
): Promise<SendDiscordWebhookResult> {
  const payload = buildPriceDropAlertPayload(input);
  return sendDiscordWebhook(payload);
}

/**
 * Sends a test notification to verify that the webhook is valid and working.
 * Showcases the clean mobile-friendly Discord embed layout.
 */
export async function pingDiscord(webhookUrl: string): Promise<SendDiscordWebhookResult> {
  const sampleShopUrl =
    "https://shop.amul.com/en/product/amul-chocolate-whey-protein-34-g-or-pack-of-30-sachets";
  const sampleImgUrl =
    "https://shop.amul.com/s/62fa94df8c13af2e242eba16/6a4e2160fdab14de18031795/01-hero-image_amul-whey-protein-carton-chocolateg-1020kg.png";

  return sendDiscordWebhook({
    webhookUrl,
    username: "⚡ Latch Amul Radar",
    embeds: [
      {
        author: {
          name: "Amul Chocolate Whey Protein, 34 g | Pack of 30 sachets",
          icon_url: sampleImgUrl,
          url: sampleShopUrl,
        },
        color: 0xffffff,
        description: [
          "## ₹2,500  •  🟢 145 qty",
          "",
          "-# PROTEIN & VALUE",
          "💪 **750g** total (25g/sachet)  •  ⚡ **₹2.45/g**",
          "",
          `👉 [**⚡ Buy on Amul Store ↗**](${sampleShopUrl})`,
        ].join("\n"),
        image: { url: sampleImgUrl },
        footer: { text: "Latch Amul Radar • Non-Custodial Zero-Auth" },
        timestamp: new Date().toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "⚡ Buy on Amul Store ↗",
            url: sampleShopUrl,
          },
        ],
      },
    ],
  });
}
