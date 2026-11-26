/**
 * دستورهای مدیریتی دیجی: مدیران ربات، کاربران ویژه، فیلتر کلمات، لیست‌ها،
 * پاک‌سازی، خوشامد و مجازات‌ها.
 */
import type { GroupSettingsRow, TgMessage } from "../_shared/types.ts";
import {
  countRows,
  deleteRows,
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from "../_shared/db.ts";
import { faDate, faNum } from "../_shared/texts.ts";
import { escapeHtml } from "../_shared/validation.ts";
import {
  bannedWords,
  clearWordsCache,
  digiCard,
  type DigiDeps,
  punish,
  saveSettings,
  say,
  stripPunct,
  targetOf,
} from "./digi_core.ts";

/** آیا این متن یکی از دستورهای مدیریتی است؟ */
export function isAdminText(text: string): boolean {
  if (
    /^(پنل|تنظیمات|panel)$/.test(text) || /^(?:قفل|بستن)\s+/.test(text) ||
    /^(?:بازکردن|باز کردن|رفع قفل)\s+/.test(text)
  ) {
    return false;
  }
  return /^(پیکربندی|افزودن مدیر|عزل مدیر|عزل کاربران مدیر|لیست کاربران مدیر|افزودن ویژه|عزل ویژه|عزل کاربران ویژه|لیست کاربران ویژه|لیست بن|لیست سکوت|پاکسازی بن ها|پاکسازی بنها|پاکسازی سکوت ها|پاکسازی سکوتها|رفع سکوت ها|رفع سکوتها|لیست فیلتر|خوشامد|جدول امتیاز|تعداد اخطار \d+|حذف \d+|بن|رفع مسدودیت|ان بن|سکوت|سکوت \d+|لغو سکوت|ان میوت|اخطار|کسر اخطار)$/
    .test(text) ||
    /^(?:فیلتر کردن|فیلتر)\s+.+$/.test(text) ||
    /^حذف فیلتر\s+.+$/.test(text) ||
    /^خوشامد متن\s+.+$/.test(text);
}

export async function handleAdminCommand(
  deps: DigiDeps,
  message: TgMessage,
  text: string,
  raw: string,
  settings: GroupSettingsRow,
): Promise<boolean> {
  const chatId = message.chat.id;
  const from = message.from!;
  const targetId = targetOf(message);

  // ─── پاک‌سازی پیام‌ها ──────────────────────────────────────────────────────
  const purge = text.match(/^حذف\s+(\d+)$/);
  if (purge) {
    const requested = Math.min(Math.max(Number(purge[1]), 1), 100);
    let deleted = 0;
    for (let index = 1; index <= requested; index++) {
      const id = message.message_id - index;
      if (id <= 0) break;
      try {
        await deps.tg.deleteMessage(chatId, id);
        deleted++;
      } catch {
        // پیام قدیمی یا حذف‌شده
      }
    }
    try {
      await deps.tg.deleteMessage(chatId, message.message_id);
    } catch {
      // پیام دستور
    }
    await say(
      deps,
      chatId,
      digiCard("🧹 <b>پاک‌سازی</b>", [
        `${faNum(deleted)} پیام از ${faNum(requested)} درخواست پاک شد.`,
        "<i>تلگرام حذف پیام‌های قدیمی‌تر از ۴۸ ساعت را اجازه نمی‌دهد.</i>",
      ]),
    );
    return true;
  }

  // ─── عدد تنظیمات ──────────────────────────────────────────────────────────
  const warnLimit = text.match(/^تعداد اخطار\s+(\d+)$/);
  if (warnLimit) {
    const limit = Math.min(Math.max(Number(warnLimit[1]), 1), 10);
    await saveSettings(deps, chatId, { warn_limit: limit });
    await say(
      deps,
      chatId,
      digiCard("⚠️ <b>تعداد اخطار</b>", [
        `از این پس بعد از ${faNum(limit)} اخطار، مجازات اعمال می‌شود.`,
      ]),
    );
    return true;
  }

  // ─── مدیران و کاربران ویژه ─────────────────────────────────────────────────
  if (text === "پیکربندی") {
    await say(
      deps,
      chatId,
      digiCard("👮 <b>پیکربندی مدیران</b>", [
        "➊ <code>افزودن مدیر</code> — با ریپلای",
        "➋ <code>عزل مدیر</code>",
        "➌ <code>لیست کاربران مدیر</code>",
        "➍ <code>عزل کاربران مدیر</code>",
        "",
        "⭐ کاربر ویژه: قفل و فیلتر برایش اعمال نمی‌شود.",
        "<code>افزودن ویژه</code> · <code>عزل ویژه</code> · <code>لیست کاربران ویژه</code>",
      ]),
    );
    return true;
  }

  const staff = text.match(/^(افزودن مدیر|عزل مدیر|افزودن ویژه|عزل ویژه)$/);
  if (staff) {
    if (!targetId) {
      await say(
        deps,
        chatId,
        digiCard("👮 <b>مدیران ربات</b>", [
          "روی پیام کاربر ریپلای کن و دستور را بفرست.",
        ]),
      );
      return true;
    }
    const adding = staff[1].startsWith("افزودن");
    const role = staff[1].includes("ویژه") ? "vip" : "admin";
    try {
      if (adding) {
        const already = await selectOne<{ id: number }>(
          deps.sb,
          "group_staff",
          (q) => q.eq("group_id", chatId).eq("user_id", targetId).eq("role", role),
        );
        if (!already) {
          await insertRow(deps.sb, "group_staff", {
            group_id: chatId,
            user_id: targetId,
            role,
            added_by: from.id,
          });
        }
      } else {
        await deleteRows(deps.sb, "group_staff", { group_id: chatId, user_id: targetId, role });
      }
      await say(
        deps,
        chatId,
        digiCard(adding ? "✅ <b>افزوده شد</b>" : "🗑 <b>عزل شد</b>", [
          `${role === "vip" ? "کاربر ویژه" : "مدیر ربات"}: <code>${targetId}</code>`,
        ]),
      );
    } catch (error) {
      await say(
        deps,
        chatId,
        `⚠️ ${(error as Error).message}\n<i>جدول group_staff را با digi.sql بساز.</i>`,
      );
    }
    return true;
  }

  if (/^(لیست کاربران مدیر|لیست کاربران ویژه|عزل کاربران مدیر|عزل کاربران ویژه)$/.test(text)) {
    const role = text.includes("مدیر") ? "admin" : "vip";
    try {
      if (text.startsWith("عزل")) {
        const removed = await deleteRows(deps.sb, "group_staff", { group_id: chatId, role });
        await say(deps, chatId, digiCard("🧹 <b>پاک‌سازی</b>", [`${faNum(removed)} مورد حذف شد.`]));
        return true;
      }
      const rows = await selectRows<{ user_id: number }>(
        deps.sb,
        "group_staff",
        (q) => q.eq("group_id", chatId).eq("role", role).limit(100),
      );
      await say(
        deps,
        chatId,
        digiCard(
          role === "vip" ? "⭐ <b>کاربران ویژه</b>" : "👮 <b>مدیران ربات</b>",
          rows.length === 0
            ? ["فهرست خالی است."]
            : rows.map((row, index) => `${faNum(index + 1)}. <code>${row.user_id}</code>`),
        ),
      );
    } catch (error) {
      await say(deps, chatId, `⚠️ ${(error as Error).message}`);
    }
    return true;
  }

  // ─── فیلتر کلمات ──────────────────────────────────────────────────────────
  const filterAdd = raw.match(/^\s*(?:فیلتر\s+کردن|فیلتر)\s+(.+)$/i);
  const filterRemove = raw.match(/^\s*حذف\s+فیلتر\s+(.+)$/i);
  if (filterAdd || filterRemove) {
    const word = stripPunct(filterAdd?.[1] ?? filterRemove?.[1] ?? "");
    if (word.length < 2) {
      await say(deps, chatId, "⚠️ کلمهٔ فیلتر باید حداقل ۲ حرف باشد.");
      return true;
    }
    try {
      if (filterAdd) {
        const existing = await selectOne<{ id: number }>(
          deps.sb,
          "group_words",
          (q) => q.eq("group_id", chatId).eq("word", word),
        );
        if (!existing) {
          await insertRow(deps.sb, "group_words", { group_id: chatId, word, created_by: from.id });
        }
      } else {
        await deleteRows(deps.sb, "group_words", { group_id: chatId, word });
      }
      clearWordsCache(chatId);
      await say(
        deps,
        chatId,
        digiCard(filterAdd ? "🔤 <b>فیلتر شد</b>" : "✅ <b>فیلتر برداشته شد</b>", [
          `کلمه: <code>${escapeHtml(word)}</code>`,
        ]),
      );
    } catch (error) {
      await say(
        deps,
        chatId,
        `⚠️ ${(error as Error).message}\n<i>جدول group_words را با digi.sql بساز.</i>`,
      );
    }
    return true;
  }

  if (text === "لیست فیلتر") {
    const words = await bannedWords(deps, chatId);
    await say(
      deps,
      chatId,
      digiCard(
        "🔤 <b>فیلتر کلمات</b>",
        words.length === 0
          ? ["فهرست خالی است."]
          : [words.map((word) => `<code>${escapeHtml(word)}</code>`).join(" · ")],
      ),
    );
    return true;
  }

  // ─── خوشامد ──────────────────────────────────────────────────────────────
  if (text === "خوشامد") {
    await say(
      deps,
      chatId,
      digiCard("👋 <b>پیام خوش‌آمد</b>", [
        settings.welcome_enabled ? "وضعیت: 🟢 فعال" : "وضعیت: 🔴 خاموش",
        "",
        escapeHtml(settings.welcome_text),
        "",
        "متغیرها: <code>TIME</code> <code>DATE</code> <code>YEAR</code> <code>MONTH</code> " +
        "<code>DAY</code> <code>USERID</code> <code>CHATID</code> <code>GAP_NAME</code> " +
        "<code>BOTUSER</code> <code>USERNAME</code> <code>FIRST_NAME</code> <code>LAST_NAME</code>",
        "تنظیم: <code>خوشامد متن سلام {name} خوش آمدی</code>",
      ]),
    );
    return true;
  }

  const welcomeSet = raw.match(/^\s*خوشامد\s+متن\s+([\s\S]+)$/);
  if (welcomeSet) {
    const value = welcomeSet[1].trim().slice(0, 900);
    await saveSettings(deps, chatId, { welcome_text: value, welcome_enabled: true });
    await say(deps, chatId, digiCard("👋 <b>خوش‌آمد تنظیم شد</b>", [escapeHtml(value)]));
    return true;
  }

  // ─── لیست‌ها ──────────────────────────────────────────────────────────────
  if (text === "لیست بن" || text === "لیست سکوت") {
    const kind = text === "لیست بن" ? "ban" : "mute";
    try {
      const rows = await selectRows<{ user_id: number; created_at: string }>(
        deps.sb,
        "group_bans",
        (q) => q.eq("group_id", chatId).eq("kind", kind).eq("is_active", true).limit(100),
      );
      await say(
        deps,
        chatId,
        digiCard(
          kind === "ban" ? "🚫 <b>لیست بن</b>" : "🔇 <b>لیست سکوت</b>",
          rows.length === 0
            ? ["فهرست خالی است."]
            : rows.map((row, index) =>
              `${faNum(index + 1)}. <code>${row.user_id}</code> — ${
                faDate(row.created_at, "Asia/Tehran")
              }`
            ),
        ),
      );
    } catch (error) {
      await say(deps, chatId, `⚠️ ${(error as Error).message}`);
    }
    return true;
  }

  if (
    /^(پاکسازی بن ها|پاکسازی بنها|پاکسازی سکوت ها|پاکسازی سکوتها|رفع سکوت ها|رفع سکوتها)$/.test(
      text,
    )
  ) {
    const kind = text.includes("بن") ? "ban" : "mute";
    try {
      const removed = await updateRows(deps.sb, "group_bans", {
        is_active: false,
        lifted_at: new Date().toISOString(),
        lifted_by: from.id,
      }, { group_id: chatId, kind, is_active: true });
      await say(
        deps,
        chatId,
        digiCard("🧹 <b>پاک‌سازی فهرست</b>", [`${faNum(removed.length)} مورد بسته شد.`]),
      );
    } catch (error) {
      await say(deps, chatId, `⚠️ ${(error as Error).message}`);
    }
    return true;
  }

  if (text === "جدول امتیاز") {
    try {
      const rows = await selectRows<{ user_id: number; score: number }>(
        deps.sb,
        "group_scores",
        (q) => q.eq("group_id", chatId).order("score", { ascending: false }).limit(10),
      );
      await say(
        deps,
        chatId,
        digiCard(
          "🏆 <b>جدول امتیاز</b>",
          rows.length === 0
            ? ["هنوز امتیازی ثبت نشده."]
            : rows.map((row, index) =>
              `${faNum(index + 1)}. <code>${row.user_id}</code> — ${faNum(row.score)}`
            ),
        ),
      );
    } catch (error) {
      await say(deps, chatId, `⚠️ ${(error as Error).message}`);
    }
    return true;
  }

  // ─── مجازات‌ها ────────────────────────────────────────────────────────────
  const mute = text.match(/^سکوت(?:\s+(\d+))?$/);

  if (/^(بن|رفع مسدودیت|ان بن)$/.test(text)) {
    if (!targetId) {
      await say(
        deps,
        chatId,
        digiCard("🚫 <b>بن</b>", [
          "روی پیام کاربر ریپلای کن و بنویس <code>بن</code>.",
        ]),
      );
      return true;
    }
    try {
      if (text === "بن") {
        await deps.tg.banChatMember(chatId, targetId);
        await insertRow(deps.sb, "group_bans", {
          group_id: chatId,
          user_id: targetId,
          kind: "ban",
          reason: "دستور ادمین (دیجی)",
          created_by: from.id,
        }).catch(() => undefined);
        await say(
          deps,
          chatId,
          digiCard("🚫 <b>مسدود شد</b>", [
            `کاربر <code>${targetId}</code> بن شد.`,
          ]),
        );
      } else {
        await deps.tg.unbanChatMember(chatId, targetId);
        await updateRows(deps.sb, "group_bans", {
          is_active: false,
          lifted_at: new Date().toISOString(),
          lifted_by: from.id,
        }, { group_id: chatId, user_id: targetId, is_active: true }).catch(() => undefined);
        await say(
          deps,
          chatId,
          digiCard("✅ <b>رفع مسدودی</b>", [
            `کاربر <code>${targetId}</code> آزاد شد.`,
          ]),
        );
      }
    } catch (error) {
      await say(deps, chatId, `⚠️ ${(error as Error).message}`);
    }
    return true;
  }

  if (mute) {
    if (!targetId) {
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
        Number(mute[1] ?? settings.mute_duration_minutes) || settings.mute_duration_minutes,
        1,
      ),
      525600,
    );
    try {
      const until = new Date(Date.now() + minutes * 60_000);
      await deps.tg.restrictChatMember(chatId, targetId, until);
      await insertRow(deps.sb, "group_bans", {
        group_id: chatId,
        user_id: targetId,
        kind: "mute",
        reason: `سکوت ${minutes} دقیقه`,
        expires_at: until.toISOString(),
        created_by: from.id,
      }).catch(() => undefined);
      await say(
        deps,
        chatId,
        digiCard("🔇 <b>سکوت</b>", [
          `کاربر <code>${targetId}</code> برای ${faNum(minutes)} دقیقه سکوت شد.`,
        ]),
      );
    } catch (error) {
      await say(deps, chatId, `⚠️ ${(error as Error).message}`);
    }
    return true;
  }

  if (/^(لغو سکوت|ان میوت)$/.test(text)) {
    if (!targetId) {
      await say(
        deps,
        chatId,
        digiCard("🔊 <b>لغو سکوت</b>", [
          "روی پیام کاربر ریپلای کن و بنویس <code>لغو سکوت</code>.",
        ]),
      );
      return true;
    }
    try {
      await deps.tg.unrestrictChatMember(chatId, targetId);
      await updateRows(deps.sb, "group_bans", {
        is_active: false,
        lifted_at: new Date().toISOString(),
        lifted_by: from.id,
      }, { group_id: chatId, user_id: targetId, kind: "mute", is_active: true }).catch(() =>
        undefined
      );
      await say(
        deps,
        chatId,
        digiCard("🔊 <b>لغو سکوت</b>", [
          `کاربر <code>${targetId}</code> آزاد شد.`,
        ]),
      );
    } catch (error) {
      await say(deps, chatId, `⚠️ ${(error as Error).message}`);
    }
    return true;
  }

  if (/^(اخطار|کسر اخطار)$/.test(text)) {
    if (!targetId) {
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
          user_id: targetId,
          warned_by: from.id,
          reason: "دستور ادمین (دیجی)",
        });
        const total = await countRows(
          deps.sb,
          "user_warnings",
          (q) => q.eq("group_id", chatId).eq("user_id", targetId).eq("is_active", true),
        );
        if (total >= settings.warn_limit) {
          const result = await punish(deps, chatId, targetId, settings, total);
          await updateRows(deps.sb, "user_warnings", {
            is_active: false,
            revoked_at: new Date().toISOString(),
            revoked_by: 0,
          }, { group_id: chatId, user_id: targetId, is_active: true }).catch(() => undefined);
          await say(
            deps,
            chatId,
            digiCard("🚨 <b>حد اخطار</b>", [
              `کاربر <code>${targetId}</code> به ${faNum(total)} اخطار رسید و ${result}.`,
            ]),
          );
        } else {
          await say(
            deps,
            chatId,
            digiCard("⚠️ <b>اخطار</b>", [
              `کاربر <code>${targetId}</code> اخطار گرفت (${faNum(total)} از ${
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
        }, { group_id: chatId, user_id: targetId, is_active: true }).catch(() => undefined);
        await say(
          deps,
          chatId,
          digiCard("✅ <b>کسر اخطار</b>", [
            `اخطارهای <code>${targetId}</code> پاک شد.`,
          ]),
        );
      }
    } catch (error) {
      await say(deps, chatId, `⚠️ ${(error as Error).message}`);
    }
    return true;
  }

  // قفل‌ها در ماژول دیگر مدیریت می‌شوند.
  return false;
}
