/**
 * 🇩🇬 همان ظاهر دیجی‌انتی، این بار در چت خصوصی.
 *
 * در گروه، `handleDigiPlus` مسئول است؛ این ماژول فقط PV را می‌گیرد تا متن‌هایی
 * مثل «راهنما»، «ایدی» و «پنل» به کارت‌های قدیمیِ پاسخ‌های سریع نرسند.
 */
import { keyboard, urlButton } from "../_shared/keyboards.ts";
import { faDate, faDateTime, faNum } from "../_shared/texts.ts";
import type { TgMessage } from "../_shared/types.ts";
import { digiCard, type DigiDeps, helpCard, normalize, say } from "./digi_core.ts";

const HELP_WORDS = ["راهنما", "دستورات", "کمک", "help"];
const ID_WORDS = ["ایدی", "ایدی من", "شناسه", "شناسه من", "id", "myid"];
const PANEL_WORDS = ["پنل", "تنظیمات", "منو", "panel", "menu"];
const RULES_WORDS = ["قوانین", "rules"];

export async function handleDigiPrivate(deps: DigiDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  if (chat.type !== "private") return false;
  const from = message.from;
  if (!from || from.is_bot) return false;

  const raw = (message.text ?? "").trim();
  if (!raw || raw.startsWith("/")) return false;

  const text = normalize(raw);
  const chatId = chat.id;
  const target = message.reply_to_message?.from ?? from;

  if (HELP_WORDS.includes(text)) {
    await say(deps, chatId, helpCard());
    return true;
  }

  if (ID_WORDS.includes(text)) {
    await say(
      deps,
      chatId,
      digiCard("🆔 <b>شناسه‌ها</b>", [
        `شما: <code>${from.id}</code>`,
        `نام: ${from.first_name ?? "—"}`,
        `یوزرنیم: ${from.username ? `@${from.username}` : "ندارد"}`,
      ]),
    );
    return true;
  }

  if (PANEL_WORDS.includes(text)) {
    await say(
      deps,
      chatId,
      digiCard("🛡 <b>پنل اسپیکسل</b>", [
        `١. چت هوشمند: <code>/ai سؤالت</code>`,
        `٢. کارت معرفی: <code>بیو</code>`,
        `٣. ابزارها و بازی: دکمهٔ «🧰 ابزارها»`,
        `٤. پنل گروه: در گروه بنویس <code>پنل</code>`,
        `٥. امکانات ربات: ${faNum(38)} دستور فعال`,
        "",
        "برای گروه، ربات را ادمین کن تا قفل‌ها و مدیریت کار کند.",
      ]),
      keyboard([
        [
          { text: "🧰 ابزارها", callback_data: "u:tb", style: "primary" },
          { text: "👤 بیو من", callback_data: "u:bi", style: "success" },
        ],
        [{ text: "📋 سرورهای گروه", callback_data: "u:gm", style: "primary" }],
        [
          urlButton(
            "➕ افزودن به گروه",
            `https://t.me/${deps.cfg.botUsername}?startgroup=true`,
            "success",
          ),
        ],
      ]),
    );
    return true;
  }

  if (RULES_WORDS.includes(text)) {
    await say(
      deps,
      chatId,
      digiCard("📜 <b>قوانین گروه</b>", [
        "قوانین هر گروه را مدیر همان گروه تعیین می‌کند.",
        "در گروه بنویس <code>قوانین</code> تا متن قوانین همان گروه را ببینی.",
      ]),
    );
    return true;
  }

  if (text === "ساعت") {
    const now = new Date();
    await say(
      deps,
      chatId,
      digiCard("🕒 <b>ساعت</b>", [
        `اکنون: <b>${faDateTime(now)}</b>`,
        `تاریخ: ${faDate(now)}`,
      ]),
    );
    return true;
  }

  if (text === "تاریخ") {
    const now = new Date();
    await say(deps, chatId, digiCard("📅 <b>تاریخ امروز</b>", [`<b>${faDate(now)}</b>`]));
    return true;
  }

  // برای این کاربر با ریپلای روی پیام خودش، شناسه را نشان بده (کاربرد رایج PV).
  if (text === "امتیاز" && target !== from) {
    await say(
      deps,
      chatId,
      digiCard("⭐ <b>امتیاز</b>", [
        `${target.first_name ?? "کاربر"}: امتیازها در گروه ثبت می‌شوند.`,
      ]),
    );
    return true;
  }

  return false;
}
