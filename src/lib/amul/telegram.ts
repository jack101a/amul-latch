import { TELEGRAM_ORIGIN } from "./types";

export interface DetectChatResult {
  ok: boolean;
  chatId?: string;
  userName?: string;
  firstName?: string;
  error?: string;
}

/**
 * Automatically inspects the bot's latest updates to find the chat_id of the user
 * who initiated contact with the bot (e.g., clicked /start or sent a message).
 */
export async function autoDetectTelegramChatId(botToken: string): Promise<DetectChatResult> {
  const token = botToken.trim();
  if (!token) return { ok: false, error: "Enter your Telegram Bot Token first" };

  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,50}$/.test(token)) {
    return { ok: false, error: "Invalid Telegram bot token format" };
  }

  const url = `${TELEGRAM_ORIGIN}/bot${token}/getUpdates?limit=10&offset=-10`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const json = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: Array<{
        message?: { chat?: { id?: number | string; username?: string; first_name?: string } };
        edited_message?: { chat?: { id?: number | string; username?: string; first_name?: string } };
        callback_query?: { message?: { chat?: { id?: number | string; username?: string; first_name?: string } } };
        channel_post?: { chat?: { id?: number | string; username?: string; first_name?: string } };
      }>;
    };

    if (!res.ok || !json.ok) {
      return { ok: false, error: json.description || `Telegram HTTP ${res.status}` };
    }

    const updates = json.result || [];
    if (updates.length === 0) {
      return {
        ok: false,
        error:
          "No interactions detected yet. Open your bot in Telegram, tap 'Start' or send 'hi', then click Auto-detect again.",
      };
    }

    // Inspect updates from newest to oldest for the first valid chat
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const chat =
        u.message?.chat ||
        u.edited_message?.chat ||
        u.callback_query?.message?.chat ||
        u.channel_post?.chat;
      if (chat?.id) {
        return {
          ok: true,
          chatId: String(chat.id),
          userName: chat.username,
          firstName: chat.first_name,
        };
      }
    }

    return {
      ok: false,
      error: "No recent messages with chat ID found. Send /start to your bot in Telegram, then retry.",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to connect to Telegram API",
    };
  }
}

export async function sendTelegram(input: {
  botToken: string;
  chatId?: string;
  text: string;
}): Promise<{ ok: boolean; chatId?: string; error?: string }> {
  const token = input.botToken.trim();
  let chatId = input.chatId?.trim() || "";

  if (!token) return { ok: false, error: "Telegram bot token is not configured" };

  // Validate format to prevent SSRF or URL path manipulation
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,50}$/.test(token)) {
    return { ok: false, error: "Invalid Telegram bot token format" };
  }

  // If chat ID wasn't provided, attempt to auto-detect from the bot's latest update
  if (!chatId) {
    const detected = await autoDetectTelegramChatId(token);
    if (!detected.ok || !detected.chatId) {
      return {
        ok: false,
        error:
          detected.error ||
          "Telegram Chat ID is missing. Send /start to your bot in Telegram, then click 'Auto-detect'.",
      };
    }
    chatId = detected.chatId;
  }

  if (!/^(-?\d+|@[A-Za-z0-9_]{4,32})$/.test(chatId)) {
    return { ok: false, error: "Invalid Telegram chat ID format" };
  }

  const url = `${TELEGRAM_ORIGIN}/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: input.text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.description || `Telegram HTTP ${res.status}` };
    }
    return { ok: true, chatId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Telegram failed" };
  }
}

