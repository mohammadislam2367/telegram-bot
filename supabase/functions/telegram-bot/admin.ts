/**
 * دستورهای فارسی گروه (با یا بدون اسلش) — همه از یک نقطه:
 * عمومی‌ها، پنل، قفل‌ها، مدیران، فیلتر، مجازات و پاک‌سازی.
 */
import {
  banMember,
  card,
  type Cfg,
  deleteMessage,
  esc,
  faNum,
  normalize,
  sendMessage,
  targetOf,
  type TgMessage,
  unbanMember,
} from "./core.ts";
import { LOCK_LABELS, lockKey } from "./locks.ts";
import { HELP_TEXT, mainMarkup, mainScreen, toggleLockByText } from "./panel.ts";
import {
  addStaff,
  addWarning,
  addWord,
  bumpScore,
  clearWarnings,
  isGroupAdmin,
  listStaff,
  listWords,
  loadSettings,
  punish,
  removeStaff,
  removeWord,
  saveSettings,
  scoreOf,
} from "./store.ts";
import { clearAllBans } from "./guard.ts";

const PUBLIC = new Set(["قوانین", "rules", "راهنما", "help", "دستورات", "ایدی", "آیدی", "id"]);
const PANEL = new Set(["پنل", "تنظیمات", "panel"]);

async function reply(cfg: Cfg, message: TgMessage, text: string, markup?: unknown): Promise<void> {
  await sendMessage(cfg, message.chat.id, text, {
    replyTo: message.message_id,
    markup: markup as never,
  });
}

async function purge(cfg: Cfg, message: TgMessage, count: number): Promise<number> {
  let deleted = 0;
  for (let offset = 1; offset <= count; offset++) {
    if (await deleteMessage(cfg, message.chat.id, message.message_id - offset)) deleted++;
  }
  await deleteMessage(cfg, message.chat.id, message.message_id);
  return deleted;
}

/** true یعنی دستور مصرف شد. */
export async function handleGroupText(cfg: Cfg, message: TgMessage): Promise<boolean> {
  const from = message.from;
  const chat = message.chat;
  if (!from || from.is_bot) return false;
  const raw = (message.text ?? "").trim();
  if (!raw) return false;

  const text = normalize(raw);
  const chatId = chat.id;
  const target = targetOf(message);
  const settings = await loadSettings(cfg, chat);

  // ─── عمومی ────────────────────────────────────────────────────────────────
  if (text === "قوانین" || text === "rules") {
    const body = (settings.rules_text ?? "").trim() || "قوانینی ثبت نشده است.";
    await reply(cfg, message, card("📜 <b>قوانین گروه</b>", [esc(body)]));
    return true;
  }
  if (text === "راهنما" || text === "help" || text === "دستورات") {
    await reply(cfg, message, HELP_TEXT);
    return true;
  }
  if (text === "ایدی" || text === "آیدی" || text === "id") {
    await reply(
      cfg,
      message,
      card("🆔 <b>شناسه‌ها</b>", [`گروه: <code>${chatId}</code>`, `شما: <code>${from.id}</code>`]),
    );
    return true;
  }
  if (text === "امتیاز" && target) {
    const score = await scoreOf(cfg, chatId, target);
    const name = message.reply_to_message?.from?.first_name ?? String(target);
    await reply(cfg, message, card("⭐ <b>امتیاز</b>", [`${esc(name)}: <b>${faNum(score)}</b>`]));
    return true;
  }
  if ((text === "مثبت" || text === "منفی") && target) {
    if (!(await isGroupAdmin(cfg, chatId, from.id))) {
      await reply(cfg, message, "⛔ امتیاز دادن فقط برای مدیران است.");
      return true;
    }
    const score = await bumpScore(cfg, chatId, target, text === "مثبت" ? 1 : -1);
    const name = message.reply_to_message?.from?.first_name ?? String(target);
    await reply(
      cfg,
      message,
      card(text === "مثبت" ? "➕ <b>امتیاز مثبت</b>" : "➖ <b>امتیاز منفی</b>", [
        `${esc(name)}: <b>${faNum(score)}</b>`,
      ]),
    );
    return true;
  }

  const isAdmin = await isGroupAdmin(cfg, chatId, from.id);
  const needAdmin = async (): Promise<boolean> => {
    if (isAdmin) return false;
    await reply(cfg, message, "⛔ این دستور فقط برای مدیران گروه است.");
    return true;
  };

  // ─── پنل ─────────────────────────────────────────────────────────────────
  if (PANEL.has(text)) {
    if (await needAdmin()) return true;
    await sendMessage(cfg, chatId, mainScreen(settings), { markup: mainMarkup(true) });
    return true;
  }

  // ─── قفل‌ها ───────────────────────────────────────────────────────────────
  const lockMatch = text.match(/^(?:قفل|بستن)\s+(.+)$/);
  const unlockMatch = text.match(/^(?:بازکردن|باز کردن|رفع قفل)\s+(.+)$/);
  if (lockMatch || unlockMatch) {
    if (await needAdmin()) return true;
    const name = (lockMatch?.[1] ?? unlockMatch?.[1] ?? "").trim();
    if (["ها", "قفل ها", "لیست", "همه"].includes(name)) {
      const active = Object.keys(settings.locks).filter((key) => settings.locks[key]);
      await reply(
        cfg,
        message,
        card("🔐 <b>قفل‌های این گروه</b>", [
          active.length
            ? active.map((key) => LOCK_LABELS[key] ?? key).join(" · ")
            : "هیچ قفلی بسته نیست — گروه باز است 🔓",
          "",
          "بستن: <code>قفل لینک</code> · بازکردن: <code>بازکردن لینک</code>",
        ]),
      );
      return true;
    }
    const key = lockKey(name);
    if (!key) {
      await reply(
        cfg,
        message,
        card("❓ قفل ناشناخته", [
          `«${esc(name)}» را نمی‌شناسم.`,
          "مثال: <code>قفل لینک</code> · <code>قفل عکس</code> · <code>قفل همه</code>",
        ]),
      );
      return true;
    }
    const enable = Boolean(lockMatch);
    await toggleLockByText(cfg, message, name, enable);
    await reply(
      cfg,
      message,
      card(enable ? "🔒 <b>قفل شد</b>" : "🔓 <b>باز شد</b>", [
        `${LOCK_LABELS[key] ?? key} ${enable ? "قفل شد." : "باز شد."}`,
      ]),
    );
    return true;
  }

  // ─── مدیریتی ──────────────────────────────────────────────────────────────
  if (
    !/^(?:افزودن|عزل|لیست|فیلتر|حذف فیلتر|حذف|بن|رفع مسدودیت|سکوت|لغو سکوت|اخطار|کسر اخطار|تعداد اخطار|خوشامد|پاکسازی|رفع سکوتها|جدول امتیاز)/
      .test(
        text,
      )
  ) {
    return false;
  }
  if (await needAdmin()) return true;

  if (text === "افزودن مدیر" || text === "افزودن ویژه") {
    if (!target) {
      await reply(cfg, message, "روی کاربر ریپلای کن و بنویس: " + text);
      return true;
    }
    const role = text.endsWith("مدیر") ? "admin" : "vip";
    await addStaff(cfg, chatId, target, role, from.id);
    await reply(cfg, message, `✅ ${role === "admin" ? "مدیر" : "ویژه"} شد.`);
    return true;
  }
  if (text === "عزل مدیر" || text === "عزل ویژه") {
    if (!target) {
      await reply(cfg, message, "روی کاربر ریپلای کن و بنویس: " + text);
      return true;
    }
    const role = text.endsWith("مدیر") ? "admin" : "vip";
    await removeStaff(cfg, chatId, target, role);
    await reply(cfg, message, `✅ ${role === "admin" ? "از مدیران" : "از ویژه‌ها"} حذف شد.`);
    return true;
  }
  if (text === "لیست کاربران مدیر" || text === "لیست کاربران ویژه") {
    const role = text.includes("مدیر") ? "admin" : "vip";
    const rows = (await listStaff(cfg, chatId)).filter((row) => row.role === role);
    await reply(
      cfg,
      message,
      card(role === "admin" ? "👮 <b>مدیران</b>" : "⭐ <b>ویژه‌ها</b>", [
        rows.length ? rows.map((row) => `• <code>${row.user_id}</code>`).join("\n") : "— خالی",
      ]),
    );
    return true;
  }

  const filterAdd = text.match(/^فیلتر کردن\s+(.+)$/);
  if (filterAdd) {
    const ok = await addWord(cfg, chatId, filterAdd[1].trim(), from.id);
    await reply(cfg, message, ok ? "✅ کلمه به فیلتر اضافه شد." : "⚠️ ثبت نشد (یا تکراری است).");
    return true;
  }
  const filterRemove = text.match(/^حذف فیلتر\s+(.+)$/);
  if (filterRemove) {
    const words = await listWords(cfg, chatId);
    const word = filterRemove[1].trim().toLowerCase();
    const found = words.find((row) => row.word.toLowerCase() === word);
    if (!found) {
      await reply(cfg, message, "این کلمه در فهرست نیست.");
      return true;
    }
    await removeWord(cfg, chatId, found.id);
    await reply(cfg, message, "✅ حذف شد.");
    return true;
  }
  if (text === "لیست فیلتر") {
    const words = await listWords(cfg, chatId);
    await reply(
      cfg,
      message,
      card("🔤 <b>فیلتر کلمات</b>", [
        words.length ? words.map((row) => `• ${esc(row.word)}`).join("\n") : "— خالی",
      ]),
    );
    return true;
  }

  if (["بن", "رفع مسدودیت", "سکوت", "لغو سکوت", "اخطار", "کسر اخطار"].includes(text)) {
    if (!target) {
      await reply(cfg, message, "روی کاربر ریپلای کن و دوباره بنویس.");
      return true;
    }
    if (text === "بن") {
      await banMember(cfg, chatId, target);
      await reply(cfg, message, "🚫 کاربر بن شد.");
    } else if (text === "رفع مسدودیت") {
      await unbanMember(cfg, chatId, target);
      await clearWarnings(cfg, chatId, target);
      await reply(cfg, message, "✅ مسدودیت برداشته شد.");
    } else if (text === "سکوت") {
      const result = await punish(cfg, chatId, target, { ...settings, warn_action: "mute" });
      await reply(cfg, message, `🔇 ${result}`);
    } else if (text === "لغو سکوت") {
      await unbanMember(cfg, chatId, target);
      await reply(cfg, message, "🔊 سکوت برداشته شد.");
    } else if (text === "اخطار") {
      const total = await addWarning(cfg, chatId, target, "اخطار مدیر", from.id);
      if (total >= settings.warn_limit) {
        const result = await punish(cfg, chatId, target, settings);
        await clearWarnings(cfg, chatId, target);
        await reply(cfg, message, `⚠️ ${result}`);
      } else {
        await reply(cfg, message, `⚠️ اخطار ${faNum(total)} از ${faNum(settings.warn_limit)}`);
      }
    } else {
      await clearWarnings(cfg, chatId, target);
      await reply(cfg, message, "✅ اخطارها کسر شد.");
    }
    return true;
  }

  const muteTime = text.match(/^سکوت\s+(\d{1,4})$/);
  if (muteTime) {
    if (!target) {
      await reply(cfg, message, "روی کاربر ریپلای کن و بنویس: سکوت ۱۰");
      return true;
    }
    const result = await punish(cfg, chatId, target, {
      ...settings,
      warn_action: "mute",
      mute_duration_minutes: Math.max(1, Math.min(1440, Number(muteTime[1]))),
    });
    await reply(cfg, message, `🔇 ${result}`);
    return true;
  }

  const warnLimit = text.match(/^تعداد اخطار\s+(\d{1,2})$/);
  if (warnLimit) {
    const limit = Math.max(1, Math.min(10, Number(warnLimit[1])));
    await saveSettings(cfg, chatId, { warn_limit: limit });
    await reply(cfg, message, `✅ سقف اخطار: ${faNum(limit)}`);
    return true;
  }

  const purgeMatch = text.match(/^حذف\s+(\d{1,3})$/);
  if (purgeMatch) {
    const deleted = await purge(cfg, message, Math.max(1, Math.min(200, Number(purgeMatch[1]))));
    const note = await sendMessage(
      cfg,
      chatId,
      card("🧹 <b>پاک‌سازی</b>", [
        `${faNum(deleted)} پیام پاک شد.`,
        "<i>تلگرام حذف پیام‌های قدیمی‌تر از ۴۸ ساعت را اجازه نمی‌دهد.</i>",
      ]),
    );
    return Boolean(note) || true;
  }

  if (text === "خوشامد") {
    await reply(
      cfg,
      message,
      card("👋 <b>خوش‌آمد</b>", [
        `وضعیت: ${settings.welcome_enabled ? "🟢 روشن" : "🔴 خاموش"}`,
        `<i>${esc(settings.welcome_text)}</i>`,
        "",
        "تغییر متن: <code>خوشامد متن …</code>",
      ]),
    );
    return true;
  }
  const welcomeText = raw.replace(/^خوشامد\s+متن\s+/i, "");
  if (/^خوشامد\s+متن\s+/i.test(raw) && welcomeText.trim()) {
    await saveSettings(cfg, chatId, { welcome_text: welcomeText.trim().slice(0, 600) });
    await reply(cfg, message, "✅ متن خوش‌آمد ثبت شد.");
    return true;
  }

  if (text === "رفع سکوتها" || text === "پاکسازی سکوتها" || text === "پاکسازی بنها") {
    const count = await clearAllBans(cfg, chatId);
    await reply(cfg, message, `✅ ${faNum(count)} کاربر آزاد شد.`);
    return true;
  }

  return false;
}

/** آیا این متن باید به دستورهای گروه برسد؟ */
export function looksLikeCommand(text: string): boolean {
  const value = normalize(text);
  return PUBLIC.has(value) || PANEL.has(value) ||
    /^(?:قفل|بستن|بازکردن|باز کردن|رفع قفل)\s+/.test(value);
}
