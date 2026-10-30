import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  applyConfig,
  fetchCatalog,
  fetchPromoBanners,
  getConfig,
  getSnapshot,
  pingDiscordAlert,
  pingWhatsApp,
  startWatch,
  stopWatch,
  tickOnce,
  validateCoupon,
} from "./runtime";
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
  soundEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappPhone: z.string().optional(),
  whatsappApiKey: z.string().optional(),
  discordEnabled: z.boolean().optional(),
  discordWebhookUrl: z.string().optional(),
  pollMinMs: z.number().int().min(500),
  pollMaxMs: z.number().int().min(500),
  orderCooldownMs: z.number().int().min(0),
});

export const getWatchStatus = createServerFn({ method: "POST" }).handler(async () => {
  return getSnapshot();
});

export const getServerConfig = createServerFn({ method: "POST" }).handler(async () => {
  return getConfig();
});

export const syncServerConfig = createServerFn({ method: "POST" })
  .validator(z.object({ config: configSchema.partial() }))
  .handler(async ({ data }) => {
    applyConfig(data.config);
    return getSnapshot();
  });

export const resolvePincode = createServerFn({ method: "POST" })
  .validator(z.object({ pincode: z.string() }))
  .handler(async ({ data }) => {
    return fetchCatalog(data.pincode.trim());
  });

export const getPromoBanners = createServerFn({ method: "POST" }).handler(async () => {
  return fetchPromoBanners();
});

export const validateCouponCode = createServerFn({ method: "POST" })
  .validator(z.object({ couponCode: z.string() }))
  .handler(async ({ data }) => {
    return validateCoupon(data.couponCode);
  });

export const startWatcher = createServerFn({ method: "POST" })
  .validator(z.object({ config: configSchema }))
  .handler(async ({ data }) => {
    const config = { ...DEFAULT_CONFIG, ...data.config } as AppConfig;
    if (!/^\d{6}$/.test(config.pincode)) {
      throw new Error("Enter a 6-digit Indian pincode");
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

export const testWhatsApp = createServerFn({ method: "POST" })
  .validator(z.object({ phone: z.string(), apiKey: z.string() }))
  .handler(async ({ data }) => {
    return pingWhatsApp(data.phone, data.apiKey);
  });

export const testDiscord = createServerFn({ method: "POST" })
  .validator(z.object({ webhookUrl: z.string() }))
  .handler(async ({ data }) => {
    return pingDiscordAlert(data.webhookUrl);
  });
