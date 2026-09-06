import { CALLMEBOT_ORIGIN } from "./types";

export interface SendCallMeBotInput {
  phone: string;
  apiKey: string;
  text: string;
}

export interface SendCallMeBotResult {
  ok: boolean;
  error?: string;
}

/**
 * Send a personal WhatsApp alert using the CallMeBot API.
 * The recipient does not need to grant account access or scan QR codes.
 * Requires one-time activation via WhatsApp to receive their personal apiKey.
 */
export async function sendCallMeBot(
  input: SendCallMeBotInput,
): Promise<SendCallMeBotResult> {
  const rawPhone = input.phone.trim();
  const apiKey = input.apiKey.trim();
  const text = input.text.trim();

  if (!rawPhone || !apiKey) {
    return { ok: false, error: "WhatsApp phone number and API key are required" };
  }

  // Normalize phone number: strip spaces, dashes, parentheses
  const phone = rawPhone.replace(/[\s\-()]/g, "");

  // International format validation: e.g. +919876543210 or 919876543210
  if (!/^\+?\d{8,15}$/.test(phone)) {
    return {
      ok: false,
      error: "Invalid phone number format (use international format, e.g. +919876543210)",
    };
  }

  // CallMeBot API keys are alphanumeric / numeric strings
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(apiKey)) {
    return { ok: false, error: "Invalid CallMeBot API key format" };
  }

  const url = `${CALLMEBOT_ORIGIN}/whatsapp.php?phone=${encodeURIComponent(
    phone,
  )}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(15000),
    });

    const body = await res.text();

    if (!res.ok) {
      return {
        ok: false,
        error: `CallMeBot HTTP ${res.status}: ${body.slice(0, 100)}`,
      };
    }

    // CallMeBot returns HTTP 200 even on validation failures,
    // embedding error messages in HTML (e.g. style="color:red", "APIKey is invalid", "Phone number format is incorrect")
    const lower = body.toLowerCase();
    const isError =
      lower.includes("color:red") ||
      lower.includes("error") ||
      lower.includes("apikey is invalid") ||
      lower.includes("not registered") ||
      lower.includes("not allowed");

    if (isError) {
      // Extract specific error block if present (CallMeBot puts errors in <p style="color:red"> or ERROR:...)
      const redMatch = body.match(/<p style="color:red">(.*?)<\/p>|<p style="color:red">(.*)/i);
      if (redMatch) {
        const errorPart = (redMatch[1] || redMatch[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (errorPart) return { ok: false, error: errorPart };
      }
      const errMatch = body.match(/ERROR:\s*([^<\n]+)/i);
      if (errMatch) {
        const errorPart = (errMatch[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (errorPart) return { ok: false, error: `Error: ${errorPart}` };
      }

      // Fallback: Strip HTML tags to return a readable error string
      const cleanError = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return {
        ok: false,
        error: cleanError.slice(0, 150) || "CallMeBot rejected the request",
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "CallMeBot request failed",
    };
  }
}
