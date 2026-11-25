/**
 * Telegram Webhook — Supabase Edge Function
 * امنیت: X-Telegram-Bot-Api-Secret-Token (مقایسه‌ی زمان-ثابت)
 */
import { type AppConfig, ConfigError, loadConfig } from "../_shared/config.ts";
import { getSupabase } from "../_shared/db.ts";
import { createLogger } from "../_shared/logger.ts";
import { SettingsStore } from "../_shared/settings.ts";
import { TelegramApi } from "../_shared/telegram.ts";
import { GroupAdminChecker, verifyWebhookSecret } from "../_shared/auth.ts";
import { limiter } from "../_shared/rate_limit.ts";
import { jsonResponse } from "../_shared/http.ts";
import type { TgUpdate } from "../_shared/types.ts";
import { runWithErrorHandling } from "./router.ts";
import { handleChannelPost } from "./channels.ts";
import { handleGamesMessage, handleQuizCallback } from "./games.ts";
import { handleBotGuard } from "./guard.ts";
import { handleGroupIntro } from "./group_intro.ts";
import {
  BOT_COMMANDS,
  handleBioCallback,
  handlePresetTrigger,
  handleQuickCallback,
  handleQuickMessage,
} from "./quick.ts";
import { handleToolboxCallback, handleToolboxMessage } from "./toolbox.ts";
import { handleGroupExtra, handleGroupPanelCallback } from "./group_extra.ts";
import { handleDigiText } from "./digi.ts";
import { handleDigiPlus } from "./digi_plus.ts";
import { handleBotReply } from "./replies.ts";

const SERVICE = "anime-click-ultimate-telegram-bot";

const WEBHOOK_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "callback_query",
  "chat_member",
  "my_chat_member",
];

type EdgeRuntimeLike = { waitUntil(promise: Promise<unknown>): void };

type WebhookSnapshot = {
  ok: boolean;
  repaired: boolean;
  urlConfigured: boolean;
  callbackQueryAllowed: boolean;
  allowedUpdates: string[];
};

/**
 * اگر Webhook با allowed_updates ناقص ثبت شده باشد (مثلاً فقط message)،
 * دکمه‌های inline هرگز به تابع نمی‌رسند. این تابع با استفاده از Secretهای خودِ
 * تابع، Webhook را به‌صورت idempotent دوباره ثبت می‌کند.
 */
async function syncWebhook(cfg: AppConfig, tg: TelegramApi): Promise<WebhookSnapshot> {
  const expectedUrl = `${cfg.supabaseUrl}/functions/v1/telegram-bot`;
  const info = await tg.getWebhookInfo() as {
    url?: string;
    allowed_updates?: string[];
  };

  const allowedUpdates = info.allowed_updates ?? [];
  const missing = WEBHOOK_ALLOWED_UPDATES.filter((name) => !allowedUpdates.includes(name));
  const healthy = info.url === expectedUrl && missing.length === 0;

  if (healthy || !cfg.webhookSecret) {
    return {
      ok: healthy,
      repaired: false,
      urlConfigured: Boolean(info.url),
      callbackQueryAllowed: allowedUpdates.includes("callback_query"),
      allowedUpdates,
    };
  }

  await tg.call<boolean>("setWebhook", {
    url: expectedUrl,
    secret_token: cfg.webhookSecret,
    allowed_updates: WEBHOOK_ALLOWED_UPDATES,
    max_connections: 40,
  });

  const after = await tg.getWebhookInfo() as {
    url?: string;
    allowed_updates?: string[];
  };
  const afterAllowed = after.allowed_updates ?? [];
  const stillMissing = WEBHOOK_ALLOWED_UPDATES.filter((name) => !afterAllowed.includes(name));

  return {
    ok: after.url === expectedUrl && stillMissing.length === 0,
    repaired: true,
    urlConfigured: Boolean(after.url),
    callbackQueryAllowed: afterAllowed.includes("callback_query"),
    allowedUpdates: afterAllowed,
  };
}

function edgeRuntime(): EdgeRuntimeLike | null {
  const runtime = (globalThis as unknown as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  return runtime ?? null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    // باز کردن همین آدرس در مرورگر، Webhook ناقص را خودکار ترمیم می‌کند.
    try {
      const cfg = loadConfig();
      const tg = new TelegramApi(cfg.botToken);
      const webhook = await syncWebhook(cfg, tg);
      // ثبت دستورها در منوی رسمی تلگرام (idempotent).
      try {
        await tg.setMyCommands(BOT_COMMANDS);
      } catch {
        // ثبت منو اختیاری است
      }

      return jsonResponse({
        ok: true,
        service: SERVICE,
        message: "Telegram webhook endpoint. POST updates from Telegram only.",
        webhook,
      });
    } catch (error) {
      return jsonResponse({
        ok: true,
        service: SERVICE,
        message: "Telegram webhook endpoint. POST updates from Telegram only.",
        webhook: {
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        },
      });
    }
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

  const deps = { cfg, sb, tg, settings, log, groupAdmins, limiter };
  const extras = { cfg, sb, tg, log };
  // پست‌های کانال فرستنده (from) ندارند؛ مسیر مدیریت کانال مستقل از router اجرا می‌شود.
  const processing = update.channel_post
    ? handleChannelPost(extras, update.channel_post).catch((error: unknown) =>
      log.warn("channel update failed", { error: (error as Error).message })
    )
    : (async (): Promise<void> => {
      // دستورهای سریع، بازی‌ها و نگهبان ضد ربات قبل از مسیر اصلی بررسی می‌شوند.
      if (
        update.callback_query &&
        await handleBioCallback({ ...extras, settings }, update.callback_query)
      ) return;
      if (
        update.callback_query &&
        await handleQuickCallback({ ...extras, settings }, update.callback_query)
      ) return;
      if (
        update.callback_query &&
        await handleToolboxCallback({ ...extras, settings }, update.callback_query)
      ) return;
      if (
        update.callback_query &&
        await handleGroupPanelCallback({ ...extras, settings, groupAdmins }, update.callback_query)
      ) return;
      if (update.callback_query && await handleQuizCallback(extras, update.callback_query)) return;
      if (await handleBotGuard(extras, update)) return;
      if (
        update.message &&
        await handlePresetTrigger({ ...extras, settings, limiter }, update.message)
      ) return;
      if (update.message && await handleQuickMessage({ ...extras, settings }, update.message)) {
        return;
      }
      if (update.message && await handleToolboxMessage({ ...extras, settings }, update.message)) {
        return;
      }
      if (
        update.message &&
        await handleGroupExtra({ ...extras, settings, groupAdmins }, update.message)
      ) return;
      if (
        update.message &&
        await handleDigiPlus({ ...extras, settings, groupAdmins }, update.message)
      ) return;
      if (
        update.message &&
        await handleDigiText({ ...extras, settings, groupAdmins }, update.message)
      ) return;
      if (
        update.message &&
        await handleBotReply({ ...extras, settings, limiter }, update.message)
      ) {
        return;
      }
      if (update.message && await handleGroupIntro(extras, update.message)) return;
      if (update.message && await handleGamesMessage(extras, update.message)) return;
      await runWithErrorHandling(deps, update);
    })();

  const runtime = edgeRuntime();
  if (runtime?.waitUntil) {
    runtime.waitUntil(processing);
  } else {
    await processing;
  }

  return jsonResponse({ ok: true });
});
