import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  applyConfig,
  checkSessionCookie,
  checkoutNow,
  clearCheckout,
  disconnectSession,
  fetchCatalog,
  getSnapshot,
  pingTelegram,
  pingWhatsApp,
  setVerifiedProfile,
  startWatch,
  stopWatch,
  tickOnce,
} from "./runtime";
import { requestAmulOtp, verifyAmulOtp } from "./otp-service";
import { DEFAULT_CONFIG, type AppConfig } from "./types";

const trackedSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
  name: z.string(),
  alias: z.string(),
  productId: z.string(),
  sellerId: z.string().optional(),
});

const configSchema = z.object({
  pincode: z.string(),
  products: z.array(trackedSchema),
  autoOrder: z.boolean(),
  orderIfAlreadyInStock: z.boolean(),
  soundEnabled: z.boolean().optional(),
  telegramEnabled: z.boolean(),
  telegramBotToken: z.string(),
  telegramChatId: z.string(),
  whatsappEnabled: z.boolean().optional(),
  whatsappPhone: z.string().optional(),
  whatsappApiKey: z.string().optional(),
  sessionCookie: z.string(),
  pollMinMs: z.number().int().min(500),
  pollMaxMs: z.number().int().min(500),
  orderCooldownMs: z.number().int().min(0),
});

export const getWatchStatus = createServerFn({ method: "POST" }).handler(async () => {
  return getSnapshot();
});

export const resolvePincode = createServerFn({ method: "POST" })
  .validator(z.object({ pincode: z.string(), sessionCookie: z.string().optional() }))
  .handler(async ({ data }) => {
    if (data.sessionCookie) applyConfig({ sessionCookie: data.sessionCookie });
    return fetchCatalog(data.pincode.trim());
  });

export const startWatcher = createServerFn({ method: "POST" })
  .validator(z.object({ config: configSchema }))
  .handler(async ({ data }) => {
    const config = { ...DEFAULT_CONFIG, ...data.config } as AppConfig;
    if (!/^\d{6}$/.test(config.pincode)) {
      throw new Error("Enter a 6-digit Indian pincode");
    }
    if (!config.products.length) {
      throw new Error("Select at least one protein SKU to watch");
    }
    return startWatch(config);
  });

export const stopWatcher = createServerFn({ method: "POST" }).handler(async () => {
  return stopWatch();
});

export const tickWatcher = createServerFn({ method: "POST" })
  .validator(z.object({ config: configSchema.optional() }))
  .handler(async ({ data }) => {
    return tickOnce(data.config);
  });

export const startCheckout = createServerFn({ method: "POST" })
  .validator(z.object({ sku: z.string(), config: configSchema.optional() }))
  .handler(async ({ data }) => {
    if (data.config) applyConfig(data.config);
    return checkoutNow(data.sku);
  });

export const dismissCheckout = createServerFn({ method: "POST" }).handler(async () => {
  return clearCheckout();
});

export const testTelegram = createServerFn({ method: "POST" })
  .validator(z.object({ botToken: z.string(), chatId: z.string() }))
  .handler(async ({ data }) => {
    return pingTelegram(data.botToken, data.chatId);
  });

export const testWhatsApp = createServerFn({ method: "POST" })
  .validator(z.object({ phone: z.string(), apiKey: z.string() }))
  .handler(async ({ data }) => {
    return pingWhatsApp(data.phone, data.apiKey);
  });

export const verifySessionCookie = createServerFn({ method: "POST" })
  .validator(z.object({ sessionCookie: z.string() }))
  .handler(async ({ data }) => {
    return checkSessionCookie(data.sessionCookie);
  });

export const requestLoginOtp = createServerFn({ method: "POST" })
  .validator(z.object({ phone: z.string() }))
  .handler(async ({ data }) => {
    return requestAmulOtp(data.phone);
  });

export const submitLoginOtp = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), otp: z.string() }))
  .handler(async ({ data }) => {
    const res = await verifyAmulOtp(data.token, data.otp);
    if (res.ok && res.sessionCookie) {
      applyConfig({ sessionCookie: res.sessionCookie });
      if (res.profile) {
        setVerifiedProfile(res.sessionCookie, res.profile);
      }
    }
    return res;
  });

export const disconnectSessionAction = createServerFn({ method: "POST" }).handler(async () => {
  return disconnectSession();
});

