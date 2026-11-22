
/**
 * Health check — بدون نمایش اطلاعات محرمانه.
 * ?deep=1 اتصال Telegram و وضعیت Webhook را بررسی می‌کند.
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
  ip_address?: string;
  max_connections?: number;
  has_custom_certificate?: boolean;
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "GET") {
    return jsonResponse(
      { ok: false, error: "method_not_allowed" },
      405,
    );
  }

  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";

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
      error: "config",
      missing,
    }, 503);
  }

  const checks: Record<
    string,
    { ok: boolean; detail?: string | Record<string, unknown> }
  > = {};

  let databaseOk = false;
  let telegramOk = true;

  // Database check
  try {
    databaseOk = await pingDatabase(getSupabase(cfg));
    checks.database = { ok: databaseOk };
  } catch (error) {
    checks.database = {
      ok: false,
      detail: (error as Error).message.slice(0, 120),
    };
  }

  // Telegram and Webhook checks
  if (deep) {
    try {
      const tg = new TelegramApi(cfg.botToken);

      const me = await tg.getMe();

      checks.telegram = {
        ok: true,
        detail: `@${me.username ?? me.id}`,
      };

      const info = await tg.getWebhookInfo() as WebhookInfo;

      const allowedUpdates = info.allowed_updates ?? null;

      const callbackQueryAllowed = allowedUpdates === null
        ? true
        : allowedUpdates.includes("callback_query");

      const webhookConfigured = Boolean(info.url);

      checks.webhook = {
        ok: webhookConfigured,
        detail: {
          urlConfigured: webhookConfigured,
          callbackQueryAllowed,
          allowedUpdates,
          pendingUpdates: info.pending_update_count ?? 0,
          hasLastError: Boolean(info.last_error_date),
          lastErrorDate: info.last_error_date ?? null,
          lastErrorMessage: info.last_error_message ?? null,
          maxConnections: info.max_connections ?? null,
          hasCustomCertificate: info.has_custom_certificate ?? false,
        },
      };

      if (!webhookConfigured) {
        telegramOk = false;
      }
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
    version: "1.1.0",
    time: new Date().toISOString(),
    checks,
  }, ok ? 200 : 503);
});
