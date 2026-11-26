/**
 * 🇩🇬 کارت خانهٔ چت خصوصی — اولین صفحه‌ای که کاربر می‌بیند.
 *
 * در گروه، `handleDigiPlus` مسئول است؛ این ماژول فقط PV را می‌گیرد تا متن‌هایی
 * مثل «راهنما»، «ایدی» و «پنل» به کارت‌های قدیمیِ پاسخ‌های سریع نرسند.
 */
import { keyboard, urlButton } from "../_shared/keyboards.ts";
import { faDate, faDateTime, faNum } from "../_shared/texts.ts";
import type { TgInlineKeyboardButton, TgMessage, TgUser } from "../_shared/types.ts";
import { digiCard, type DigiDeps, helpCard, normalize, say } from "./digi_core.ts";

const HELP_WORDS = ["راهنما", "دستورات", "کمک", "help"];
const ID_WORDS = ["ایدی", "ایدی من", "شناسه", "شناسه من", "id", "myid"];
const HOME_WORDS = ["شروع", "خانه", "منو", "پنل", "start", "home", "menu", "panel"];
const RULES_WORDS = ["قوانین", "rules"];

/** کارت خانهٔ PV — چیدمان ثابت: سرگرمی، حساب، راهنما، مالک، افزودن به گروه. */
export function homeCard(
  deps: DigiDeps,
  user: TgUser,
): { text: string; markup: unknown } {
  const isOwner = deps.cfg.superAdminIds.includes(user.id);
  const name = user.first_name || "دوست عزیز";

  const rows: TgInlineKeyboardButton[][] = [
    [
      { text: "🤖 چت هوشمند", callback_data: "dg:ai", style: "success" as const },
      { text: "🎮 بازی و سرگرمی", callback_data: "u:gm", style: "primary" as const },
    ],
    [
      { text: "👤 کارت معرفی من", callback_data: "u:bi", style: "primary" as const },
      { text: "🧰 جعبه‌ابزار", callback_data: "u:tb", style: "primary" as const },
    ],
    [
      { text: "📋 راهنمای دستورها", callback_data: "dg:h", style: "primary" as const },
      { text: "📜 قوانین", callback_data: "dg:gr", style: "primary" as const },
    ],
    [{ text: "ℹ️ دربارهٔ ربات", callback_data: "dg:about", style: "primary" as const }],
  ];

  if (isOwner) {
    rows.push([{ text: "👑 پنل مالک ربات", callback_data: "dg:o", style: "success" as const }]);
  }

  rows.push([
    urlButton(
      "➕ افزودن به گروه",
      `https://t.me/${deps.cfg.botUsername}?startgroup=true`,
      "success",
    ),
  ]);

  return {
    text: digiCard("🤖 <b>اسپیکسل</b> · دستیار هوشمند", [
      `👋 <b>${name}</b> خوش آمدی!`,
      "",
      "<b>چه کارهایی می‌کنم؟</b>",
      `• چت هوشمند فارسی: <code>/ai سؤالت</code>`,
      `• مدیریت گروه با ${faNum(37)} قفل، ضدلینک، ضداسپم و اخطار`,
      "• بازی و سرگرمی، جست‌وجوی انیمه، اخبار و جعبه‌ابزار",
      "",
      "در گروه بنویس <code>پنل</code> تا پنل مدیریت باز شود.",
      "👇 از دکمه‌های زیر شروع کن:",
    ]),
    markup: keyboard(rows),
  };
}

export async function handleDigiPrivate(deps: DigiDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  if (chat.type !== "private") return false;
  const from = message.from;
  if (!from || from.is_bot) return false;

  const raw = (message.text ?? "").trim();
  if (!raw) return false;

  const chatId = chat.id;
  const isCommand = raw.startsWith("/");
  if (isCommand && !/^\/(start|menu|panel|home)\b/i.test(raw)) return false;

  const text = normalize(raw.replace(/^\//, "").split(/\s/)[0] ?? "");
  const target = message.reply_to_message?.from ?? from;

  if (isCommand || HOME_WORDS.includes(text)) {
    const home = homeCard(deps, from);
    await say(deps, chatId, home.text, home.markup as never);
    return true;
  }

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
