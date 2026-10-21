export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
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
 * Sends a message or embeds to a Discord webhook endpoint.
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
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });

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
 */
export async function pingDiscord(webhookUrl: string): Promise<SendDiscordWebhookResult> {
  return sendDiscordWebhook({
    webhookUrl,
    username: "⚡ Latch Amul Radar",
    embeds: [
      {
        title: "📡 LATCH AMUL RADAR · TELEMETRY ONLINE",
        description:
          "🎯 **Discord Webhook Channel Connected Successfully!**\n\nLatch is actively scanning Amul regional substores and fulfillment hubs. When any watched protein product restocks in your delivery area, an instant rich alert with live stock quantities, protein economics, product photos, and 1-tap checkout links will be dispatched here.",
        url: "https://shop.amul.com",
        color: 0x00e676, // Cyber Emerald Green
        fields: [
          { name: "📡 Radar Status", value: "Operational 🟢", inline: true },
          { name: "⚡ Polling Engine", value: "Adaptive REST ⚡", inline: true },
          { name: "🛡️ Architecture", value: "Zero-Auth & Safe 🛡️", inline: true },
          {
            name: "📦 Monitored Categories",
            value: "Whey Protein (Raw & Chocolate), High Protein Shakes, Buttermilk, Paneer",
            inline: false,
          },
          {
            name: "🚀 Quick Link",
            value: "👉 [Browse Live Store on shop.amul.com](https://shop.amul.com)",
            inline: false,
          },
        ],
        footer: { text: "Latch Amul Protein Restock Radar • Ready to alert" },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}
