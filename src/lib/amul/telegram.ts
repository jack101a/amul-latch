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

export interface TelegramInlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface TelegramReplyMarkup {
  inline_keyboard?: TelegramInlineButton[][];
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number | string; username?: string; first_name?: string };
    date: number;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string; first_name?: string };
    message?: {
      message_id: number;
      chat: { id: number | string };
      text?: string;
    };
    data?: string;
  };
}

export async function sendTelegram(input: {
  botToken: string;
  chatId?: string;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
  parseMode?: "HTML" | "Markdown";
}): Promise<{ ok: boolean; chatId?: string; messageId?: number; error?: string }> {
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
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: input.text,
      disable_web_page_preview: true,
    };
    if (input.parseMode) {
      payload.parse_mode = input.parseMode;
    }
    if (input.replyMarkup) {
      payload.reply_markup = input.replyMarkup;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.description || `Telegram HTTP ${res.status}` };
    }
    return { ok: true, chatId, messageId: json.result?.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Telegram failed" };
  }
}

export async function answerCallbackQuery(input: {
  botToken: string;
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const token = input.botToken.trim();
  if (!token) return { ok: false, error: "Bot token missing" };

  const url = `${TELEGRAM_ORIGIN}/bot${token}/answerCallbackQuery`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callback_query_id: input.callbackQueryId,
        text: input.text,
        show_alert: input.showAlert ?? false,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.description || `Telegram HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to answer callback query",
    };
  }
}

export async function fetchTelegramUpdates(input: {
  botToken: string;
  offset?: number;
  limit?: number;
  timeoutSeconds?: number;
}): Promise<{ ok: boolean; updates: TelegramUpdate[]; error?: string }> {
  const token = input.botToken.trim();
  if (!token) return { ok: false, updates: [], error: "Bot token missing" };

  const timeout = Math.max(0, Math.min(input.timeoutSeconds ?? 10, 30));
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  let query = `?limit=${limit}&timeout=${timeout}`;
  if (typeof input.offset === "number") {
    query += `&offset=${input.offset}`;
  }

  const url = `${TELEGRAM_ORIGIN}/bot${token}/getUpdates${query}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout((timeout + 5) * 1000),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: TelegramUpdate[];
    };
    if (!res.ok || !json.ok) {
      return { ok: false, updates: [], error: json.description || `Telegram HTTP ${res.status}` };
    }
    return { ok: true, updates: json.result || [] };
  } catch (err) {
    return {
      ok: false,
      updates: [],
      error: err instanceof Error ? err.message : "Failed to fetch Telegram updates",
    };
  }
}

