/**
 * 🇩🇬 لایهٔ «دیجی‌انتی‌وار» — دستورهای فارسی بدون اسلش، کارت‌های تزئین‌شده و
 * پنل دکمه‌ای شیشه‌ای. این ماژول قبل از پاسخ‌های معمولی گروه اجرا می‌شود، پس
 * متن‌هایی مثل «قفل لینک»، «بازکردن همگانی»، «سکوت ۲۶»، «بن» و «پنل» کار می‌کنند.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { GroupAdminChecker } from "../_shared/auth.ts";
import type { GroupSettingsRow, TgMessage } from "../_shared/types.ts";
import { countRows, insertRow, selectOne, updateRows } from "../_shared/db.ts";
import { keyboard } from "../_shared/keyboards.ts";
import { faNum } from "../_shared/texts.ts";
import { escapeHtml, normalizeDigits } from "../_shared/validation.ts";
import { buildPermissions, hasPermissionLocks, LOCK_DEFS, normalizeLocks } from "./locks.ts";

export interface DigiDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
  groupAdmins: GroupAdminChecker;
}

const DIVIDER = "─━┅┅┈ ✁ ┈┅┅━─";
const FOOTER = "━━ 🆂🅿🅸🆇🅻🅴 ━━";

/** ظاهر کارت‌ها، عین استایل دیجی‌انتی. */
export function digiCard(title: string, lines: string[]): string {
  return [title, DIVIDER, ...lines, DIVIDER, FOOTER].filter(Boolean).join("\n");
}

/** نام‌های فارسی هر قفل — همان چیزی که کاربر در گروه می‌نویسد. */
const LOCK_ALIASES: Record<string, string[]> = {
  all: ["همگانی", "همه", "کل", "گروه"],
  link: ["لینک", "لینک ها", "لینکها", "لینک‌ها"],
  photo: ["عکس", "تصویر", "عکس ها"],
  video: ["ویدیو", "فیلم", "ویدئو"],
  file: ["فایل", "سند", "فایل ها"],
  sticker: ["استیکر", "گیف", "استیکر گیف"],
  voice: ["ویس", "صدا", "ویز"],
  music: ["اهنگ", "آهنگ", "موزیک", "موسیقی"],
  poll: ["نظرسنجی", "نظر سنجی", "پرسش"],
  preview: ["پیش نمایش", "پیش‌نمایش", "پریویو"],
  username: ["یوزرنیم", "منشن", "ایدی", "آیدی", "یوزر"],
  hashtag: ["هشتگ", "هشتک", "تگ"],
  forward: ["فوروارد", "فروارد", "فرستاده"],
  curse: ["فحاشی", "فحش", "بددهنی"],
  long: ["پیام طولانی", "طولانی", "متن طولانی"],
  english: ["انگلیسی", "لاتین"],
  contact: ["مخاطب", "شماره", "شماره تلفن"],
  location: ["لوکیشن", "موقعیت", "مکان"],
  bot: ["ربات", "بات"],
};

function normalize(value: string): string {
  return normalizeDigits(value)
    .replace(/[\u200c\u200e\u200f]/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[.!؟?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function lockKeyFromName(name: string): string | null {
  const wanted = normalize(name);
  for (const [key, aliases] of Object.entries(LOCK_ALIASES)) {
    if (aliases.some((alias) => normalize(alias) === wanted)) return key;
  }
  return null;
}

function lockLabel(key: string): string {
  const def = LOCK_DEFS.find((item) => item.key === key);
  return def ? `${def.emoji} ${def.label}` : key;
}

async function isGroupAdmin(deps: DigiDeps, chatId: number, userId: number): Promise<boolean> {
  if (deps.cfg.superAdminIds.includes(userId)) return true;
  const result = await deps.groupAdmins.getMember(chatId, userId);
  return result.isAdmin;
}

async function loadSettings(deps: DigiDeps, chatId: number): Promise<GroupSettingsRow | null> {
  try {
    const existing = await selectOne<GroupSettingsRow>(
      deps.sb,
      "group_settings",
      (q) => q.eq("group_id", chatId),
    );
    if (existing) return existing;
    return await insertRow<GroupSettingsRow>(deps.sb, "group_settings", { group_id: chatId });
  } catch (error) {
    await deps.log.warn("digi settings unavailable", { chatId, error: (error as Error).message });
    return null;
  }
}

async function saveSettings(
  deps: DigiDeps,
  chatId: number,
  patch: Partial<GroupSettingsRow>,
): Promise<void> {
  await updateRows(deps.sb, "group_settings", {
    ...patch,
    updated_at: new Date().toISOString(),
  }, { group_id: chatId });
}

async function say(deps: DigiDeps, chatId: number, text: string, markup?: unknown): Promise<void> {
  try {
    await deps.tg.sendMessage(chatId, text, {
      preview: false,
      markup: markup as never,
    });
  } catch (error) {
    await deps.log.warn("digi send failed", { chatId, error: (error as Error).message });
  }
}

async function applyPermissions(
  deps: DigiDeps,
  chatId: number,
  locks: Record<string, boolean>,
): Promise<void> {
  const permissions = hasPermissionLocks(locks)
    ? buildPermissions(locks)
    : { ...buildPermissions({}) };
  await deps.tg.call<boolean>("setChatPermissions", { chat_id: chatId, permissions });
}

function locksCard(settings: GroupSettingsRow): string {
  const locks = normalizeLocks(settings.locks);
  const on = LOCK_DEFS.filter((def) => locks[def.key]).map((def) => `${def.emoji} ${def.label}`);
  return digiCard("🔐 <b>قفل‌های این گروه</b>", [
    on.length === 0 ? "هیچ قفلی بسته نیست — گروه باز است 🔓" : on.join(" · "),
    "",
    "بستن: <code>قفل لینک</code>",
    "بازکردن: <code>بازکردن لینک</code>",
  ]);
}

function panelText(settings: GroupSettingsRow): string {
  const locks = normalizeLocks(settings.locks);
  const on = (value: boolean) => value ? "🟢" : "🔴";
  return digiCard("🛡 <b>پنل مدیریت گروه</b>", [
    `١. قفل‌ها: ${on(Object.keys(locks).length > 0)} ${faNum(Object.keys(locks).length)} فعال`,
    `٢. ضدلینک: ${on(settings.antilink_enabled)} · ضدتبچی: ${on(settings.antispam_enabled)}`,
    `٣. ضدفوروارد: ${on(settings.block_forwards)} · خوش‌آمد: ${on(settings.welcome_enabled)}`,
    `٤. تأیید هویت: ${on(settings.verify_enabled)} · سختگیرانه: ${on(settings.strict_mode)}`,
    `٥. اخطار: ${faNum(settings.warn_limit)} تا ${
      settings.warn_action === "mute" ? "سکوت" : settings.warn_action === "kick" ? "اخراج" : "بن"
    } · سکوت: ${faNum(settings.mute_duration_minutes)} دقیقه`,
  ]);
}

function panelMarkup(privateUrl: string) {
  return keyboard([
    [
      { text: "🔐 قفل‌ها", callback_data: "gp:p:3", style: "success" },
      { text: "📜 قوانین", callback_data: "gp:rules", style: "primary" },
    ],
    [
      { text: "🛡 ضدلینک", callback_data: "gp:t:antilink_enabled", style: "primary" },
      { text: "🧹 ضدتبچی", callback_data: "gp:t:antispam_enabled", style: "primary" },
    ],
    [
      { text: "👋 خوش‌آمد", callback_data: "gp:t:welcome_enabled", style: "primary" },
      { text: "📤 ضدفوروارد", callback_data: "gp:t:block_forwards", style: "primary" },
    ],
    [
      { text: "🔍 تأیید هویت", callback_data: "gp:t:verify_enabled", style: "primary" },
      { text: "⚖️ سختگیرانه", callback_data: "gp:t:strict_mode", style: "primary" },
    ],
    [
      { text: "🔇 مدت سکوت", callback_data: "gp:show:mute", style: "primary" },
      { text: "⚠️ حد اخطار", callback_data: "gp:show:warn", style: "primary" },
    ],
    [
      { text: "🔒 قفل گروه", callback_data: "gp:lock", style: "danger" },
      { text: "🔓 باز کردن", callback_data: "gp:unlock", style: "success" },
    ],
    [
      { text: "⚙️ تنظیمات کامل", url: privateUrl },
      { text: "❌ بستن", callback_data: "gp:close", style: "danger" },
    ],
  ]);
}

function helpCard(): string {
  return digiCard("🤖 <b>راهنمای دستورها</b>", [
    "🔐 <code>قفل لینک</code> · <code>بازکردن لینک</code> (هر قفلی)",
    "🔇 <code>قفل همگانی</code> · <code>بازکردن همگانی</code>",
    "🚫 <code>بن</code> · <code>رفع مسدودیت</code> (با ریپلای یا آیدی)",
    "🔇 <code>سکوت</code> · <code>سکوت ۲۶</code> · <code>لغو سکوت</code>",
    "⚠️ <code>اخطار</code> · <code>کسر اخطار</code> · <code>تعداد اخطار ۴</code>",
    "🧹 <code>حذف ۱۰۰</code> · 📜 <code>قوانین</code> · 🛡 <code>پنل</code>",
    "🍿 <code>انیمه نام</code> · 📰 <code>اخبار</code> · 🎲 <code>تاس</code>",
    "🤖 <code>/ai سؤالت</code> برای چت هوشمند",
  ]);
}

function targetOf(message: TgMessage, rest: string): { id: number | null; rest: string } {
  const reply = message.reply_to_message?.from;
  if (reply && !reply.is_bot) return { id: reply.id, rest };
  const match = normalizeDigits(rest).match(/^(\d{3,20})\s*([\s\S]*)$/);
  if (match) return { id: Number(match[1]), rest: match[2].trim() };
  return { id: null, rest };
}

/** true یعنی همان‌جا پاسخ داده شد. */
export async function handleDigiText(deps: DigiDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;
  const from = message.from;
  if (!from || from.is_bot) return false;

  const raw = (message.text ?? "").trim();
  if (!raw || raw.startsWith("/")) return false;

  const text = normalize(raw);
  const chatId = chat.id;

  // ─── دستورهای عمومی (همهٔ اعضا) ───────────────────────────────────────────
  if (text === "قوانین" || text === "rules") {
    const settings = await loadSettings(deps, chatId);
    await say(
      deps,
      chatId,
      digiCard("📜 <b>قوانین گروه</b>", [
        escapeHtml(settings?.rules_text ?? "قوانینی ثبت نشده است."),
      ]),
    );
    return true;
  }

  if (text === "راهنما" || text === "help" || text === "دستورات") {
    await say(deps, chatId, helpCard());
    return true;
  }

  if (text === "ایدی" || text === "آیدی" || text === "id") {
    await say(
      deps,
      chatId,
      digiCard("🆔 <b>شناسه‌ها</b>", [
        `گروه: <code>${chatId}</code>`,
        `شما: <code>${from.id}</code>`,
      ]),
    );
    return true;
  }

  const lockMatch = text.match(/^(?:قفل|بستن)\s+(.+)$/);
  const unlockMatch = text.match(/^(?:بازکردن|باز کردن|رفع قفل)\s+(.+)$/);
  const isPanel = ["پنل", "تنظیمات", "panel", "settings"].includes(text);
  const isPunishment =
    /^(بن|رفع مسدودیت|ان بن|سکوت|سکوت \d+|لغو سکوت|ان میوت|اخطار|کسر اخطار|تعداد اخطار \d+|حذف \d+)$/
      .test(text);

  if (!isPanel && !lockMatch && !unlockMatch && !isPunishment) return false;

  if (!(await isGroupAdmin(deps, chatId, from.id))) {
    await say(deps, chatId, "⛔ این دستور فقط برای مدیران گروه است.");
    return true;
  }

  if (isPanel) {
    const settings = await loadSettings(deps, chatId);
    if (!settings) {
      await say(deps, chatId, "⚠️ تنظیمات گروه در دسترس نیست. بعداً تلاش کن.");
      return true;
    }
    const privateUrl = `https://t.me/${deps.cfg.botUsername}?start=admin`;
    await say(deps, chatId, panelText(settings), panelMarkup(privateUrl));
    return true;
  }

  if (lockMatch || unlockMatch) {
    const name = (lockMatch?.[1] ?? unlockMatch?.[1] ?? "").trim();
    if (["ها", "هاي", "قفل ها", "لیست"].includes(normalize(name))) {
      const settings = await loadSettings(deps, chatId);
      await say(deps, chatId, settings ? locksCard(settings) : "⚠️ تنظیمات در دسترس نیست.");
      return true;
    }
    const key = lockKeyFromName(name);
    if (!key) {
      await say(
        deps,
        chatId,
        digiCard("❓ قفل ناشناخته", [
          `«${escapeHtml(name)}» را نمی‌شناسم.`,
          "مثال: <code>قفل لینک</code> · <code>قفل عکس</code> · <code>قفل همگانی</code>",
        ]),
      );
      return true;
    }

    const settings = await loadSettings(deps, chatId);
    if (!settings) {
      await say(deps, chatId, "⚠️ تنظیمات گروه در دسترس نیست.");
      return true;
    }
    const locks = normalizeLocks(settings.locks);
    const locking = Boolean(lockMatch);
    if (locking) locks[key] = true;
    else delete locks[key];

    try {
      await saveSettings(deps, chatId, { locks });
      await applyPermissions(deps, chatId, locks);
      await say(
        deps,
        chatId,
        digiCard(locking ? "🔒 <b>قفل شد</b>" : "🔓 <b>باز شد</b>", [
          `${lockLabel(key)} ${locking ? "قفل شد." : "باز شد."}`,
          ...(key === "all"
            ? [locking ? "همهٔ اعضا فقط با اجازهٔ مدیر می‌توانند بنویسند." : "اعضا دوباره آزادند."]
            : []),
        ]),
      );
    } catch (error) {
      await deps.log.warn("digi lock failed", { chatId, error: (error as Error).message });
      await say(
        deps,
        chatId,
        "⚠️ اعمال قفل انجام نشد. مطمئن شو ربات ادمین است و دسترسی «مدیریت گروه» دارد.\n" +
          "<i>اگر ستون locks هنوز روی دیتابیس ساخته نشده، یک‌بار apply-database.sh را اجرا کن.</i>",
      );
    }
    return true;
  }

  // ─── مجازات‌ها ─────────────────────────────────────────────────────────────
  const settings = await loadSettings(deps, chatId);
  if (!settings) {
    await say(deps, chatId, "⚠️ تنظیمات گروه در دسترس نیست.");
    return true;
  }

  const warnLimitMatch = text.match(/^تعداد اخطار\s+(\d+)$/);
  if (warnLimitMatch) {
    const limit = Math.min(Math.max(Number(warnLimitMatch[1]), 1), 10);
    try {
      await saveSettings(deps, chatId, { warn_limit: limit });
      await say(
        deps,
        chatId,
        digiCard("⚠️ <b>تعداد اخطار</b>", [
          `از این پس بعد از ${faNum(limit)} اخطار، مجازات اعمال می‌شود.`,
        ]),
      );
    } catch (error) {
      await deps.log.warn("digi warn limit failed", { chatId, error: (error as Error).message });
    }
    return true;
  }

  const purgeMatch = text.match(/^حذف\s+(\d+)$/);
  if (purgeMatch) {
    const requested = Math.min(Math.max(Number(purgeMatch[1]), 1), 100);
    let deleted = 0;
    for (let index = 1; index <= requested; index++) {
      const messageId = message.message_id - index;
      if (messageId <= 0) break;
      try {
        await deps.tg.deleteMessage(chatId, messageId);
        deleted++;
      } catch {
        // پیام حذف‌شده یا قدیمی — ادامه می‌دهیم
      }
    }
    try {
      await deps.tg.deleteMessage(chatId, message.message_id);
    } catch {
      // پیام دستور حذف شدنی نیست
    }
    await say(
      deps,
      chatId,
      digiCard("🧹 <b>پاک‌سازی</b>", [
        `${faNum(deleted)} پیام از ${faNum(requested)} پیام درخواستی پاک شد.`,
        "<i>تلگرام اجازهٔ حذف پیام‌های قدیمی‌تر از ۴۸ ساعت را نمی‌دهد.</i>",
      ]),
    );
    return true;
  }

  const muteMatch = text.match(/^سکوت(?:\s+(\d+))?$/);
  const { id: repliedId } = targetOf(message, "");
  const isReply = Boolean(repliedId);

  if (text === "بن" || text === "رفع مسدودیت" || text === "ان بن") {
    if (!repliedId) {
      await say(
        deps,
        chatId,
        digiCard("🚫 <b>بن</b>", ["روی پیام کاربر ریپلای کن و بنویس <code>بن</code>."]),
      );
      return true;
    }
    try {
      if (text === "بن") {
        await deps.tg.banChatMember(chatId, repliedId);
        await insertRow(deps.sb, "group_bans", {
          group_id: chatId,
          user_id: repliedId,
          kind: "ban",
          reason: "دستور ادمین (دیجی)",
          created_by: from.id,
        }).catch(() => undefined);
        await say(
          deps,
          chatId,
          digiCard("🚫 <b>مسدود شد</b>", [`کاربر <code>${repliedId}</code> از گروه بن شد.`]),
        );
      } else {
        await deps.tg.unbanChatMember(chatId, repliedId);
        await updateRows(deps.sb, "group_bans", {
          is_active: false,
          lifted_at: new Date().toISOString(),
          lifted_by: from.id,
        }, { group_id: chatId, user_id: repliedId, is_active: true }).catch(() => undefined);
        await say(
          deps,
          chatId,
          digiCard("✅ <b>رفع مسدودی</b>", [`کاربر <code>${repliedId}</code> آزاد شد.`]),
        );
      }
    } catch (error) {
      await say(deps, chatId, `⚠️ اقدام انجام نشد: ${(error as Error).message}`);
    }
    return true;
  }

  if (muteMatch) {
    if (!repliedId) {
      await say(
        deps,
        chatId,
        digiCard("🔇 <b>سکوت</b>", [
          "روی پیام کاربر ریپلای کن و بنویس <code>سکوت</code> یا <code>سکوت ۲۶</code>.",
        ]),
      );
      return true;
    }
    const minutes = Math.min(
      Math.max(
        Number(muteMatch[1] ?? settings.mute_duration_minutes) || settings.mute_duration_minutes,
        1,
      ),
      525600,
    );
    try {
      await deps.tg.restrictChatMember(
        chatId,
        repliedId,
        new Date(Date.now() + minutes * 60_000),
      );
      await insertRow(deps.sb, "group_bans", {
        group_id: chatId,
        user_id: repliedId,
        kind: "mute",
        reason: `سکوت ${minutes} دقیقه`,
        expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        created_by: from.id,
      }).catch(() => undefined);
      await say(
        deps,
        chatId,
        digiCard("🔇 <b>سکوت</b>", [
          `کاربر <code>${repliedId}</code> برای ${faNum(minutes)} دقیقه سکوت شد.`,
        ]),
      );
    } catch (error) {
      await say(deps, chatId, `⚠️ سکوت انجام نشد: ${(error as Error).message}`);
    }
    return true;
  }

  if (text === "لغو سکوت" || text === "ان میوت") {
    if (!repliedId) {
      await say(
        deps,
        chatId,
        digiCard("🔊 <b>لغو سکوت</b>", ["روی پیام کاربر ریپلای کن و بنویس <code>لغو سکوت</code>."]),
      );
      return true;
    }
    try {
      await deps.tg.unrestrictChatMember(chatId, repliedId);
      await updateRows(deps.sb, "group_bans", {
        is_active: false,
        lifted_at: new Date().toISOString(),
        lifted_by: from.id,
      }, { group_id: chatId, user_id: repliedId, kind: "mute", is_active: true }).catch(() =>
        undefined
      );
      await say(
        deps,
        chatId,
        digiCard("🔊 <b>لغو سکوت</b>", [`کاربر <code>${repliedId}</code> آزاد شد.`]),
      );
    } catch (error) {
      await say(deps, chatId, `⚠️ انجام نشد: ${(error as Error).message}`);
    }
    return true;
  }

  if (text === "اخطار" || text === "کسر اخطار") {
    if (!repliedId) {
      await say(
        deps,
        chatId,
        digiCard("⚠️ <b>اخطار</b>", [
          "روی پیام کاربر ریپلای کن و بنویس <code>اخطار</code> یا <code>کسر اخطار</code>.",
        ]),
      );
      return true;
    }
    try {
      if (text === "اخطار") {
        await insertRow(deps.sb, "user_warnings", {
          group_id: chatId,
          user_id: repliedId,
          warned_by: from.id,
          reason: "دستور ادمین (دیجی)",
        });
        const total = await countRows(
          deps.sb,
          "user_warnings",
          (q) => q.eq("group_id", chatId).eq("user_id", repliedId).eq("is_active", true),
        );
        if (total >= settings.warn_limit) {
          const until = new Date(Date.now() + settings.mute_duration_minutes * 60_000);
          if (settings.warn_action === "ban") {
            await deps.tg.banChatMember(chatId, repliedId);
          } else if (settings.warn_action === "kick") {
            await deps.tg.banChatMember(chatId, repliedId);
            await deps.tg.unbanChatMember(chatId, repliedId);
          } else {
            await deps.tg.restrictChatMember(chatId, repliedId, until);
          }
          await updateRows(deps.sb, "user_warnings", {
            is_active: false,
            revoked_at: new Date().toISOString(),
            revoked_by: 0,
          }, { group_id: chatId, user_id: repliedId, is_active: true }).catch(() => undefined);
          await say(
            deps,
            chatId,
            digiCard("🚨 <b>حد اخطار</b>", [
              `کاربر <code>${repliedId}</code> به ${faNum(total)} اخطار رسید و مجازات شد.`,
            ]),
          );
        } else {
          await say(
            deps,
            chatId,
            digiCard("⚠️ <b>اخطار</b>", [
              `کاربر <code>${repliedId}</code> اخطار گرفت (${faNum(total)} از ${
                faNum(settings.warn_limit)
              }).`,
            ]),
          );
        }
      } else {
        await updateRows(deps.sb, "user_warnings", {
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: from.id,
        }, { group_id: chatId, user_id: repliedId, is_active: true }).catch(() => undefined);
        await say(
          deps,
          chatId,
          digiCard("✅ <b>کسر اخطار</b>", [`اخطارهای <code>${repliedId}</code> پاک شد.`]),
        );
      }
    } catch (error) {
      await say(deps, chatId, `⚠️ انجام نشد: ${(error as Error).message}`);
    }
    return true;
  }

  return isReply;
}
