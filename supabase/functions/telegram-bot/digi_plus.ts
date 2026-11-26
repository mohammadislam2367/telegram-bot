/**
 * 🇩🇬 نقطهٔ ورود دستورهای فارسی گروه (بدون اسلش):
 * عمومی‌ها، قفل‌ها، پنل، فیلتر کلمات و ارجاع دستورهای مدیریتی به digi_admin.
 */
import type { GroupSettingsRow, TgMessage } from "../_shared/types.ts";
import { countRows, insertRow } from "../_shared/db.ts";
import { faNum } from "../_shared/texts.ts";
import { escapeHtml } from "../_shared/validation.ts";
import { isPhishing, LOCK_DEFS, normalizeLocks } from "./locks.ts";
import {
  applyPermissions,
  bannedWords,
  bumpScore,
  digiCard,
  type DigiDeps,
  FUN_TRIGGERS,
  funCard,
  helpCard,
  isAdmin,
  isVip,
  loadSettings,
  lockKey,
  lockLabel,
  normalize,
  punish,
  saveSettings,
  say,
  scoreOf,
  stripPunct,
  targetOf,
} from "./digi_core.ts";
import { mainMarkup, mainScreen } from "./digi_panel.ts";
import { handleAdminCommand, isAdminText } from "./digi_admin.ts";

export { renderWelcome } from "./digi_core.ts";

/** فیلتر کلمات برای اعضای عادی: true یعنی پیام حذف شد. */
async function memberChecks(deps: DigiDeps, message: TgMessage): Promise<boolean> {
  const chatId = message.chat.id;
  const from = message.from;
  if (!from) return false;
  if (await isAdmin(deps, chatId, from.id)) return false;
  if (await isVip(deps, chatId, from.id)) return false;

  const rawBody = message.text ?? message.caption ?? "";
  const body = normalize(rawBody);
  if (!body) return false;

  const settings = await loadSettings(deps, chatId);
  const words = await bannedWords(deps, chatId);
  const hit = words.find((word) => word && body.includes(word));
  const phish = !hit && Boolean(settings?.antispam_enabled) && isPhishing(rawBody);
  if (!hit && !phish) return false;

  try {
    await deps.tg.deleteMessage(chatId, message.message_id);
  } catch {
    // پیام قدیمی یا حذف‌شده
  }

  let note = hit ? "پیام حاوی کلمهٔ ممنوع حذف شد. 🧹" : "پیام حاوی لینک کلاهبرداری حذف شد. 🛡";
  if (settings) {
    try {
      await insertRow(deps.sb, "user_warnings", {
        group_id: chatId,
        user_id: from.id,
        warned_by: 0,
        reason: hit ? "فیلتر کلمات" : "ضدفیشینگ",
      });
      const total = await countRows(
        deps.sb,
        "user_warnings",
        (q) => q.eq("group_id", chatId).eq("user_id", from.id).eq("is_active", true),
      );
      note = total >= settings.warn_limit
        ? `به ${faNum(total)} اخطار رسید و ${await punish(deps, chatId, from.id, settings, total)}`
        : `اخطار ${faNum(total)} از ${faNum(settings.warn_limit)} ثبت شد.`;
    } catch {
      // ثبت اخطار اختیاری است
    }
  }

  await say(
    deps,
    chatId,
    digiCard(hit ? "🧹 <b>فیلتر کلمات</b>" : "🛡 <b>ضدفیشینگ</b>", [
      `${from.first_name}: ${hit ? "کلمهٔ ممنوع" : "لینک کلاهبرداری"}`,
      note,
    ]),
  );
  return true;
}

function locksCard(settings: GroupSettingsRow): string {
  const locks = normalizeLocks(settings.locks);
  const on = LOCK_DEFS.filter((def) => locks[def.key]).map((def) => `${def.emoji} ${def.label}`);
  return digiCard("🔐 <b>قفل‌های این گروه</b>", [
    on.length === 0 ? "هیچ قفلی بسته نیست — گروه باز است 🔓" : on.join(" · "),
    "",
    "بستن: <code>قفل لینک</code> · بازکردن: <code>بازکردن لینک</code>",
  ]);
}

/** true یعنی همان‌جا پاسخ داده شد. */
export async function handleDigiPlus(deps: DigiDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;
  const from = message.from;
  if (!from || from.is_bot) return false;

  const raw = (message.text ?? "").trim();
  if (!raw || raw.startsWith("/")) return false;

  const text = normalize(raw);
  const chatId = chat.id;
  const targetId = targetOf(message);

  // ─── عمومی ─────────────────────────────────────────────────────────────────
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

  if ((FUN_TRIGGERS as readonly string[]).includes(text)) {
    await say(deps, chatId, funCard(text));
    return true;
  }

  if (text === "امتیاز" && targetId) {
    const score = await scoreOf(deps, chatId, targetId);
    const name = message.reply_to_message?.from?.first_name ?? String(targetId);
    await say(deps, chatId, digiCard("⭐ <b>امتیاز</b>", [`${name}: <b>${score}</b>`]));
    return true;
  }

  if ((text === "مثبت" || text === "منفی") && targetId) {
    if (targetId === from.id) {
      await say(deps, chatId, "🙃 به خودت که نمی‌شود امتیاز داد!");
      return true;
    }
    if (await isAdmin(deps, chatId, from.id)) {
      const score = await bumpScore(deps, chatId, targetId, text === "مثبت" ? 1 : -1);
      const name = message.reply_to_message?.from?.first_name ?? String(targetId);
      await say(
        deps,
        chatId,
        digiCard(text === "مثبت" ? "➕ <b>امتیاز مثبت</b>" : "➖ <b>امتیاز منفی</b>", [
          `${name}: <b>${score}</b>`,
        ]),
      );
      return true;
    }
  }

  // ─── پنل و قفل‌ها ──────────────────────────────────────────────────────────
  const isPanel = ["پنل", "تنظیمات", "panel"].includes(text);
  const lockMatch = text.match(/^(?:قفل|بستن)\s+(.+)$/);
  const unlockMatch = text.match(/^(?:بازکردن|باز کردن|رفع قفل)\s+(.+)$/);

  if (isPanel) {
    if (!(await isAdmin(deps, chatId, from.id))) {
      await say(deps, chatId, "⛔ این دستور فقط برای مدیران گروه است.");
      return true;
    }
    const settings = await loadSettings(deps, chatId);
    if (!settings) {
      await say(deps, chatId, "⚠️ تنظیمات گروه در دسترس نیست. بعداً تلاش کن.");
      return true;
    }
    await say(deps, chatId, mainScreen(settings), mainMarkup(true));
    return true;
  }

  if (lockMatch || unlockMatch) {
    if (!(await isAdmin(deps, chatId, from.id))) {
      await say(deps, chatId, "⛔ این دستور فقط برای مدیران گروه است.");
      return true;
    }
    const name = (lockMatch?.[1] ?? unlockMatch?.[1] ?? "").trim();
    const settings = await loadSettings(deps, chatId);
    if (!settings) {
      await say(deps, chatId, "⚠️ تنظیمات گروه در دسترس نیست.");
      return true;
    }
    if (["ها", "قفل ها", "لیست"].includes(stripPunct(name))) {
      await say(deps, chatId, locksCard(settings));
      return true;
    }
    const key = lockKey(name);
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
        ]),
      );
    } catch (error) {
      await deps.log.warn("digi lock failed", { chatId, error: (error as Error).message });
      await say(
        deps,
        chatId,
        "⚠️ اعمال قفل انجام نشد. ربات باید ادمین با دسترسی «مدیریت گروه» باشد.\n" +
          "<i>اگر ستون locks ساخته نشده، apply-database.sh را اجرا کن.</i>",
      );
    }
    return true;
  }

  // ─── مدیریتی ───────────────────────────────────────────────────────────────
  if (isAdminText(text)) {
    if (!(await isAdmin(deps, chatId, from.id))) {
      await say(deps, chatId, "⛔ این دستور فقط برای مدیران گروه است.");
      return true;
    }
    const settings = await loadSettings(deps, chatId);
    if (!settings) {
      await say(deps, chatId, "⚠️ تنظیمات گروه در دسترس نیست.");
      return true;
    }
    return await handleAdminCommand(deps, message, text, raw, settings);
  }

  return await memberChecks(deps, message);
}
