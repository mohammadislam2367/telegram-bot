/**
 * Telegram Webhook — Supabase Edge Function
 * امنیت: X-Telegram-Bot-Api-Secret-Token (مقایسه‌ی زمان-ثابت)
 */
import { ConfigError, loadConfig } from "../_shared/config.ts";
import { getSupabase } from "../_shared/db.ts";
import { createLogger } from "../_shared/logger.ts";
import { SettingsStore } from "../_shared/settings.ts";
import { TelegramApi } from "../_shared/telegram.ts";
import { GroupAdminChecker, verifyWebhookSecret } from "../_shared/auth.ts";
import { limiter } from "../_shared/rate_limit.ts";
import { jsonResponse } from "../_shared/http.ts";
import type { TgUpdate } from "../_shared/types.ts";
import { runWithErrorHandling } from "./router.ts";

const SERVICE = "anime-click-ultimate-telegram-bot";

type EdgeRuntimeLike = { waitUntil(promise: Promise<unknown>): void };

function edgeRuntime(): EdgeRuntimeLike | null {
  const runtime = (globalThis as unknown as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  return runtime ?? null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      service: SERVICE,
      message: "Telegram webhook endpoint. POST updates from Telegram only.",
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let cfg;
  try {
    cfg = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("config error:", error.missing.join(","));
      return jsonResponse({
        ok: false,
        error: "server_not_configured",
        missing: error.missing,
      }, 500);
    }
    throw error;
  }

  if (!cfg.webhookSecret) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not set — refusing all updates");
    return jsonResponse({ ok: false, error: "webhook_secret_not_configured" }, 500);
  }

  const provided = request.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyWebhookSecret(provided, cfg.webhookSecret)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  let update: TgUpdate;
  try {
    update = await request.json() as TgUpdate;
    if (typeof update.update_id !== "number") throw new Error("missing update_id");
  } catch {
    return jsonResponse({ ok: false, error: "invalid_payload" }, 400);
  }

  const sb = getSupabase(cfg);
  const tg = new TelegramApi(cfg.botToken);
  const log = createLogger(sb, "telegram-bot");
  const settings = new SettingsStore(sb);
  const groupAdmins = new GroupAdminChecker(tg);

  const processing = runWithErrorHandling(
    { cfg, sb, tg, settings, log, groupAdmins, limiter },
    update,
  );

  const runtime = edgeRuntime();
  if (runtime?.waitUntil) {
    runtime.waitUntil(processing);
  } else {
    await processing;
  }

  return jsonResponse({ ok: true });
});
