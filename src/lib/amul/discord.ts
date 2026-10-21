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

export interface SendDiscordWebhookInput {
  webhookUrl: string;
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
  file?: {
    buffer: Buffer;
    filename: string;
  };
}

export interface SendDiscordWebhookResult {
  ok: boolean;
  error?: string;
}

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
  if (input.content) payload.content = input.content;
  if (input.embeds && input.embeds.length > 0) {
    payload.embeds = input.embeds;
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
 * Sends a test notification to verify that the webhook is valid and working.
 * Showcases the clean mobile-friendly Discord embed layout.
 */
export async function pingDiscord(webhookUrl: string): Promise<SendDiscordWebhookResult> {
  const sampleShopUrl = "https://shop.amul.com/en/product/amul-chocolate-whey-protein-cartong-1020kg";

  return sendDiscordWebhook({
    webhookUrl,
    username: "⚡ Latch Amul Radar",
    embeds: [
      {
        author: { name: "AMUL • WHEY PROTEIN" },
        title: "Amul Chocolate Whey Protein (30 Sachets)",
        url: sampleShopUrl,
        color: 0xffffff,
        description: [
          "🏷️ **Price:** ₹2,500",
          "📦 **Live Stock:** 🟢 **549 boxes** available",
          "💪 **Protein Yield:** 750g · 25g/sachet",
          "⚡ **Value Tier:** ₹2.45/g 🔥 *Best Value*",
          "📍 **Regional Hub:** 380009 · Gujarat HQ",
          "",
          `👉 [**⚡ Buy on Amul Store ↗**](${sampleShopUrl})`,
        ].join("\n"),
        footer: { text: "Latch Amul Radar • 380009" },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}
