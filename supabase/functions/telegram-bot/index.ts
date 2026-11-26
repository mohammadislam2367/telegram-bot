/**
 * اسپیکسل — نقطهٔ ورود Webhook تلگرام.
 * نسخهٔ بازنویسی‌شده از صفر (بدون وابستگی npm) روی Supabase Edge Functions.
 */
import {
  answerCallback,
  BUILD,
  card,
  type Cfg,
  dbPatch,
  dbSelect,
  displayName,
  esc,
  faNum,
  loadCfg,
  sendMessage,
  tg,
  type TgMessage,
  type TgUpdate,
} from "./core.ts";
import { handleGroupText } from "./admin.ts";
import { guardMessage } from "./guard.ts";
import { handlePanelCallback, HELP_TEXT, ownerView, privateHome } from "./panel.ts";
import { rememberUser } from "./store.ts";

const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "chat_member",
  "my_chat_member",
];

const BOT_COMMANDS = [
  { command: "start", description: "شروع و کارت خانه" },
  { command: "help", description: "راهنمای دستورها" },
  { command: "owner", description: "پنل مالک (فقط مالک)" },
  { command: "menu", description: "منوی اصلی" },
  { command: "broadcast", description: "پیام همگانی (فقط مالک)" },
];

function webhookUrl(cfg: Cfg): string {
  return `${cfg.supabaseUrl}/functions/v1/telegram-bot`;
}

async function syncWebhook(cfg: Cfg): Promise<Record<string, unknown>> {
  try {
    const info = await tg<{ url?: string; allowed_updates?: string[] }>(
      cfg,
      "getWebhookInfo",
    );
    const allowed = info.allowed_updates ?? [];
    const missing = ALLOWED_UPDATES.filter((name) => !allowed.includes(name));
    const healthy = info.url === webhookUrl(cfg) && missing.length === 0;
    if (!healthy && cfg.webhookSecret) {
      await tg(cfg, "setWebhook", {
        url: webhookUrl(cfg),
        secret_token: cfg.webhookSecret,
        allowed_updates: ALLOWED_UPDATES,
        max_connections: 40,
      });
    }
    try {
      await tg(cfg, "setMyCommands", { commands: BOT_COMMANDS });
    } catch {
      // اختیاری
    }
    return {
      urlConfigured: Boolean(info.url),
      repaired: !healthy,
      healthy,
      allowedUpdates: healthy ? allowed : ALLOWED_UPDATES,
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ─── چت خصوصی ────────────────────────────────────────────────────────────────

async function handlePrivate(cfg: Cfg, message: TgMessage): Promise<void> {
  const from = message.from!;
  const chatId = message.chat.id;
  const raw = (message.text ?? "").trim();
  const command = raw.startsWith("/") ? raw.split(/[\s@]/)[0].slice(1).toLowerCase() : "";
  const args = raw.replace(/^\/\w+(@\w+)?\s*/i, "").trim();
  const isOwner = cfg.superAdmins.includes(from.id);

  await rememberUser(cfg, from);

  if (command === "owner") {
    if (!isOwner) {
      await sendMessage(cfg, chatId, "⛔ این بخش فقط برای مالک ربات است.");
      return;
    }
    const view = await ownerView(cfg);
    await sendMessage(cfg, chatId, view.text, { markup: view.markup });
    return;
  }

  if (command === "broadcast") {
    if (!isOwner) {
      await sendMessage(cfg, chatId, "⛔ فقط مالک ربات.");
      return;
    }
    if (!args) {
      await sendMessage(cfg, chatId, "متن پیام را بنویس: <code>/broadcast سلام</code>");
      return;
    }
    const users = await dbSelect<{ telegram_id: number }>(
      cfg,
      "users",
      "broadcast_opt_in=eq.true&select=telegram_id&limit=500",
    );
    let sent = 0;
    for (const user of users) {
      const result = await sendMessage(
        cfg,
        user.telegram_id,
        card("📢 <b>اطلاعیه</b>", [
          esc(args),
        ]),
      );
      if (result) sent++;
    }
    await sendMessage(
      cfg,
      chatId,
      card("📢 <b>پیام همگانی</b>", [
        `ارسال‌شده: <b>${faNum(sent)}</b> از ${faNum(users.length)}`,
        "<i>کاربرانی که ربات را بلاک کرده‌اند شمرده نمی‌شوند.</i>",
      ]),
    );
    return;
  }

  if (command === "help") {
    await sendMessage(cfg, chatId, HELP_TEXT);
    return;
  }

  if (command === "id") {
    await sendMessage(
      cfg,
      chatId,
      card("🆔 <b>شناسه</b>", [
        `شما: <code>${from.id}</code>`,
        `چت: <code>${chatId}</code>`,
        `نام: ${esc(displayName(from))}`,
      ]),
    );
    return;
  }

  const home = privateHome(cfg, from.id);
  await sendMessage(cfg, chatId, home.text, { markup: home.markup });
}

// ─── مسیریابی ────────────────────────────────────────────────────────────────

async function handleUpdate(cfg: Cfg, update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    const done = await handlePanelCallback(cfg, update.callback_query);
    if (!done) await answerCallback(cfg, update.callback_query.id, "این دکمه قدیمی است.", true);
    return;
  }

  if (update.my_chat_member) {
    const chat = update.my_chat_member.chat;
    const status = update.my_chat_member.new_chat_member.status;
    if (chat.type === "group" || chat.type === "supergroup") {
      const active = status === "member" || status === "administrator";
      if (!active) {
        await dbPatch(cfg, "groups", `telegram_chat_id=eq.${chat.id}`, {
          is_active: false,
          left_at: new Date().toISOString(),
        });
      } else if (status === "member") {
        await sendMessage(
          cfg,
          chat.id,
          card("🛡 <b>اسپیکسل</b>", [
            "ممنون که اضافه‌ام کردی!",
            "برای فعال‌شدن قفل‌ها و پنل، من را <b>ادمین</b> کن (با دسترسی حذف پیام و محدودکردن اعضا).",
            "",
            "بعد بنویس: <code>پنل</code>",
          ]),
        );
      }
    }
    return;
  }

  const message = update.message ?? update.edited_message;
  if (!message?.from) return;

  if (message.chat.type === "private") {
    await handlePrivate(cfg, message);
    return;
  }
  if (message.chat.type !== "group" && message.chat.type !== "supergroup") return;

  if (message.new_chat_members?.length || message.left_chat_member) {
    await guardMessage(cfg, message);
    return;
  }

  if (message.text && await handleGroupText(cfg, message)) return;
  await guardMessage(cfg, message);
}

Deno.serve(async (request: Request): Promise<Response> => {
  let cfg: Cfg;
  try {
    cfg = loadCfg();
  } catch (error) {
    return json({ ok: false, error: (error as Error).message }, 500);
  }

  if (request.method === "GET") {
    return json({
      ok: true,
      service: "spixle-telegram-bot",
      build: BUILD,
      message: "Telegram webhook endpoint. POST updates from Telegram only.",
      webhook: await syncWebhook(cfg),
      bot: `@${cfg.botUsername}`,
    });
  }

  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  if (cfg.webhookSecret) {
    const token = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (token !== cfg.webhookSecret) return json({ ok: false }, 401);
  }

  let update: TgUpdate;
  try {
    update = await request.json() as TgUpdate;
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  try {
    await handleUpdate(cfg, update);
  } catch (error) {
    // همیشه 200 برمی‌گردانیم تا تلگرام آپدیت را دوباره نفرستد.
    console.error("update failed", (error as Error).message);
  }

  return json({ ok: true });
});
