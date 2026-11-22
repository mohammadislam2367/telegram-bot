
/**
 * Anime Click — Secure Webhook Setup
 * Registers Telegram webhook with callback_query enabled.
 *
 * Authentication:
 * x-setup-secret: SCHEDULER_SECRET
 */

import { loadConfig, ConfigError } from "../_shared/config.ts";
import { jsonResponse } from "../_shared/http.ts";

const SERVICE = "anime-click-webhook-setup";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "method_not_allowed" },
      405,
    );
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

  // Require a separate setup secret.
  if (!cfg.schedulerSecret) {
    return jsonResponse({
      ok: false,
      error: "scheduler_secret_not_configured",
    }, 503);
  }

  const suppliedSecret =
    request.headers.get("x-setup-secret") ?? "";

  if (!safeEqual(suppliedSecret, cfg.schedulerSecret)) {
    return jsonResponse({
      ok: false,
      error: "unauthorized",
    }, 401);
  }

  if (!cfg.webhookSecret) {
    return jsonResponse({
      ok: false,
      error: "webhook_secret_not_configured",
    }, 503);
  }

  // Telegram secret_token accepts only these characters.
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(cfg.webhookSecret)) {
    return jsonResponse({
      ok: false,
      error: "invalid_telegram_webhook_secret_format",
    }, 400);
  }

  const webhookUrl =
    `${cfg.supabaseUrl}/functions/v1/telegram-bot`;

  const allowedUpdates = [
    "message",
    "edited_message",
    "callback_query",
    "chat_member",
    "my_chat_member",
  ];

  try {
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${cfg.botToken}/setWebhook`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: cfg.webhookSecret,
          allowed_updates: allowedUpdates,
          max_connections: 40,
        }),
      },
    );

    const result = await telegramResponse.json();

    if (!telegramResponse.ok || result.ok !== true) {
      console.error("Telegram setWebhook failed:", result.description);

      return jsonResponse({
        ok: false,
        error: "telegram_set_webhook_failed",
        detail: result.description ?? "Unknown Telegram API error",
      }, 502);
    }

    // Verify the new configuration.
    const verifyResponse = await fetch(
      `https://api.telegram.org/bot${cfg.botToken}/getWebhookInfo`,
    );

    const verifyResult = await verifyResponse.json();

    if (!verifyResponse.ok || verifyResult.ok !== true) {
      return jsonResponse({
        ok: false,
        error: "webhook_verification_failed",
      }, 502);
    }

    const info = verifyResult.result;

    return jsonResponse({
      ok: true,
      service: SERVICE,
      message: "Webhook registered and verified.",
      webhook: {
        urlConfigured: Boolean(info.url),
        callbackQueryAllowed:
          info.allowed_updates?.includes("callback_query") ?? false,
        allowedUpdates: info.allowed_updates ?? [],
        pendingUpdates: info.pending_update_count ?? 0,
      },
    });
  } catch (error) {
    console.error("Webhook setup failed:", error);

    return jsonResponse({
      ok: false,
      error: "setup_failed",
    }, 500);
  }
});
