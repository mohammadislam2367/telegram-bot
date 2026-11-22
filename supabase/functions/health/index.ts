
/**
 * Anime Click Ultimate
 * Health check + secure Telegram webhook repair.
 *
 * GET  /health
 * GET  /health?deep=1
 * POST /health?repair=1
 * Header: x-setup-secret = SCHEDULER_SECRET
 */

import { ConfigError, loadConfig } from "../_shared/config.ts";
import { getSupabase, pingDatabase } from "../_shared/db.ts";
import { TelegramApi } from "../_shared/telegram.ts";
import { jsonResponse } from "../_shared/http.ts";

const SERVICE = "anime-click-ultimate-health";

type WebhookInfo = {
  url?: string;
  allowed_updates?: string[];
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  has_custom_certificate?: boolean;
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";
  const repair = url.searchParams.get("repair") === "1";

  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  if (repair && request.method !== "POST") {
    return jsonResponse({ ok: false, error: "post_required" }, 405);
  }

  if (request.method === "POST" && !repair) {
    return jsonResponse({ ok: false, error: "repair_parameter_required" }, 400);
  }

  let cfg;

  try {
    cfg = loadConfig();
  } catch (error) {
    const missing = error instanceof ConfigError
      ? error.missing
      : ["unknown"];

    return jsonResponse({
      ok: false,
      service: SERVICE,
      error: "configuration_error",
      missing,
    }, 503);
  }

  if (repair) {
    const supplied = request.headers.get("x-setup-secret") ?? "";

    if (!cfg.schedulerSecret ||
        !safeEqual(supplied, cfg.schedulerSecret)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    if (!cfg.webhookSecret ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(cfg.webhookSecret)) {
      return jsonResponse({
        ok: false,
        error: "invalid_webhook_secret_configuration",
      }, 400);
    }

    try {
      const tg = new TelegramApi(cfg.botToken);
      const webhookUrl =
        `${cfg.supabaseUrl}/functions/v1/telegram-bot`;

      const allowedUpdates = [
        "message",
        "edited_message",
        "callback_query",
        "chat_member",
        "my_chat_member",
      ];

      // Register webhook using the existing Telegram API client.
      const response = await fetch(
        `https://api.telegram.org/bot${cfg.botToken}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: webhookUrl,
            secret_token: cfg.webhookSecret,
            allowed_updates: allowedUpdates,
            max_connections: 40,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || result.ok !== true) {
        return jsonResponse({
          ok: false,
          error: "telegram_set_webhook_failed",
          detail: result.description ?? "Unknown Telegram error",
        }, 502);
      }

      const info = await tg.getWebhookInfo() as WebhookInfo;
      const callbackAllowed =
        info.allowed_updates?.includes("callback_query") ?? false;

      return jsonResponse({
        ok: Boolean(info.url) && callbackAllowed,
        service: SERVICE,
        message: "Webhook repair completed.",
        webhook: {
          urlConfigured: Boolean(info.url),
          callbackQueryAllowed: callbackAllowed,
          allowedUpdates: info.allowed_updates ?? [],
          pendingUpdates: info.pending_update_count ?? 0,
          hasLastError: Boolean(info.last_error_date),
        },
      });
    } catch (error) {
      console.error("Webhook repair failed:", error);
      return jsonResponse({
        ok: false,
        error: "webhook_repair_failed",
      }, 502);
    }
  }

  const checks: Record<string, {
    ok: boolean;
    detail?: string | Record<string, unknown>;
  }> = {};

  let databaseOk = false;
  let telegramOk = true;

  try {
    databaseOk = await pingDatabase(getSupabase(cfg));
    checks.database = { ok: databaseOk };
  } catch (error) {
    checks.database = {
      ok: false,
      detail: (error as Error).message.slice(0, 120),
    };
  }

  if (deep) {
    try {
      const tg = new TelegramApi(cfg.botToken);
      const me = await tg.getMe();

      checks.telegram = {
        ok: true,
        detail: `@${me.username ?? me.id}`,
      };

      const info = await tg.getWebhookInfo() as WebhookInfo;
      const callbackAllowed =
        info.allowed_updates?.includes("callback_query") ?? false;

      checks.webhook = {
        ok: Boolean(info.url) && callbackAllowed,
        detail: {
          urlConfigured: Boolean(info.url),
          callbackQueryAllowed: callbackAllowed,
          allowedUpdates: info.allowed_updates ?? [],
          pendingUpdates: info.pending_update_count ?? 0,
          hasLastError: Boolean(info.last_error_date),
        },
      };

      telegramOk = Boolean(info.url) && callbackAllowed;
    } catch (error) {
      telegramOk = false;
      checks.telegram = {
        ok: false,
        detail: (error as Error).message.slice(0, 120),
      };
    }
  }

  const ok = databaseOk && telegramOk;

  return jsonResponse({
    ok,
    service: SERVICE,
    version: "1.2.0",
    time: new Date().toISOString(),
    checks,
  }, ok ? 200 : 503);
});
