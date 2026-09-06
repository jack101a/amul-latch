import { TELEGRAM_ORIGIN } from "./types";

export async function sendTelegram(input: {
  botToken: string;
  chatId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const token = input.botToken.trim();
  const chatId = input.chatId.trim();
  if (!token || !chatId) return { ok: false, error: "Telegram is not configured" };

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
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Telegram failed" };
  }
}
