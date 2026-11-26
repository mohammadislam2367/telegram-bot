/**
 * 🧰 جعبه‌ابزار سریع — بدون دیتابیس و بدون هوش مصنوعی.
 * همه‌ی دستورها همین‌جا و پیش از مسیر اصلی جواب می‌گیرند، پس همیشه سریع‌اند.
 */
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { SettingsStore } from "../_shared/settings.ts";
import type { Logger } from "../_shared/logger.ts";
import type { TgCallbackQuery, TgMessage } from "../_shared/types.ts";
import { backButton, keyboard } from "../_shared/keyboards.ts";
import { divider, sectionTitle } from "../_shared/texts.ts";
import {
  clockInfo,
  formatNumber,
  pickOne,
  randomInt,
  safeCalc,
  textStats,
} from "../_shared/toolbox.ts";

export interface ToolboxDeps {
  cfg: AppConfig;
  tg: TelegramApi;
  settings: SettingsStore;
  log: Logger;
}

export const TOOL_COMMANDS = [
  "toolbox",
  "tools",
  "calc",
  "time",
  "rand",
  "pick",
  "count",
  "ping",
] as const;

function menuText(): string {
  return [
    sectionTitle("🧰 جعبه‌ابزار سریع"),
    divider(),
    "🧮 <code>/calc (12+8)*3</code> — حساب و کتاب",
    "🕒 <code>/time</code> — ساعت و تاریخ",
    "🎲 <code>/rand 1 100</code> — عدد شانسی",
    "🎯 <code>/pick اپل، سامسونگ، شیائومی</code> — انتخاب یکی",
    "📝 <code>/count متن</code> — شمارش کلمه و حرف",
    "🏓 <code>/ping</code> — سرعت پاسخ",
    divider(),
    "<i>همه‌ی این‌ها فوری جواب می‌دهند و به هوش مصنوعی نیاز ندارند.</i>",
  ].join("\n");
}

async function reply(deps: ToolboxDeps, chatId: number, text: string): Promise<void> {
  try {
    await deps.tg.sendMessage(chatId, text, { preview: false });
  } catch (error) {
    await deps.log.warn("toolbox reply failed", { chatId, error: (error as Error).message });
  }
}

/** true یعنی همان‌جا جواب داده شد. */
export async function handleToolboxMessage(
  deps: ToolboxDeps,
  message: TgMessage,
): Promise<boolean> {
  const text = (message.text ?? "").trim();
  if (!text.startsWith("/")) return false;

  const [head, ...restParts] = text.split(/\s+/);
  const command = head.slice(1).split("@")[0].toLowerCase();
  if (!(TOOL_COMMANDS as readonly string[]).includes(command)) return false;

  const args = restParts.join(" ").trim();
  const chatId = message.chat.id;
  let out = "";

  if (command === "toolbox" || command === "tools") {
    await reply(deps, chatId, menuText());
    return true;
  }

  if (command === "calc") {
    if (!args) {
      out = "🧮 مثال: <code>/calc (12+8)*3</code>";
    } else {
      const result = safeCalc(args);
      out = result.ok
        ? `🧮 <code>${args}</code>\n= <b>${formatNumber(result.value)}</b>`
        : `⚠️ ${result.error}`;
    }
  } else if (command === "time") {
    let zone = "Asia/Tehran";
    try {
      zone = await deps.settings.get("timezone");
    } catch {
      // منطقه‌ی زمانی پیش‌فرض کافی است
    }
    const info = clockInfo(new Date(), zone);
    out = [
      sectionTitle("🕒 ساعت و تاریخ"),
      divider(),
      info.weekday ? `📅 ${info.weekday}` : "",
      `🗓 ${info.date}`,
      `⏰ <b>${info.time}</b>`,
      `<i>منطقه‌ی زمانی: ${info.zone}</i>`,
    ].filter(Boolean).join("\n");
  } else if (command === "rand") {
    const parts = args.split(/[\s,،]+/).filter(Boolean);
    const min = parts[0] === undefined ? 1 : Number(parts[0]);
    const max = parts[1] === undefined ? 100 : Number(parts[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      out = "⚠️ دو عدد درست بفرست، مثل <code>/rand 1 100</code>";
    } else {
      out = `🎲 عدد شانسی بین ${formatNumber(Math.min(min, max))} و ` +
        `${formatNumber(Math.max(min, max))}:\n🎯 <b>${randomInt(min, max)}</b>`;
    }
  } else if (command === "pick") {
    const items = args.split(/[,،\n]+/).map((s) => s.trim()).filter(Boolean);
    const choice = pickOne(items);
    out = choice
      ? `🎯 انتخاب شد: <b>${choice}</b>\n<i>از بین ${items.length} گزینه</i>`
      : "⚠️ گزینه‌ها را با ویرگول جدا کن، مثل <code>/pick اپل، سامسونگ</code>";
  } else if (command === "count") {
    const target = args ||
      message.reply_to_message?.text ||
      message.reply_to_message?.caption ||
      "";
    if (!target.trim()) {
      out = "📝 متن را بعد از دستور بنویس یا روی یک پیام ریپلای کن.";
    } else {
      const stats = textStats(target);
      out = [
        sectionTitle("📝 آمار متن"),
        divider(),
        `🔤 حرف (با فاصله): ${stats.chars}`,
        `🔡 حرف (بدون فاصله): ${stats.charsNoSpace}`,
        `📚 کلمه: ${stats.words}`,
        `📄 خط: ${stats.lines}`,
        `⏱ زمان خواندن: حدود ${stats.readingSeconds} ثانیه`,
      ].join("\n");
    }
  } else if (command === "ping") {
    const started = Date.now();
    try {
      await deps.tg.getMe();
      out = `🏓 زنده و سرحال!\n⚡ پاسخ سرور: <b>${Date.now() - started}</b> میلی‌ثانیه`;
    } catch {
      out = "🏓 ربات بالاست، ولی ارتباط با تلگرام الان کند است.";
    }
  }

  await reply(deps, chatId, out);
  return true;
}

/** دکمه‌ی «🧰 جعبه‌ابزار» در منوی کاربر. */
export async function handleToolboxCallback(
  deps: ToolboxDeps,
  cq: TgCallbackQuery,
): Promise<boolean> {
  const data = cq.data ?? "";
  if (data !== "u:tb") return false;

  try {
    await deps.tg.answerCallback(cq.id, "");
  } catch {
    // پاسخ به دکمه اختیاری است
  }

  const markup = keyboard([[backButton("u:m", "↩️ بازگشت"), {
    text: "🏠 منوی اصلی",
    callback_data: "u:m",
    style: "success",
  }]]);
  const chatId = cq.message?.chat.id;
  if (chatId && cq.message) {
    try {
      await deps.tg.editMessageText(chatId, cq.message.message_id, menuText(), { markup });
      return true;
    } catch {
      // پیام قابل ویرایش نبود؛ نسخه‌ی جدید می‌فرستیم
    }
  }
  if (chatId) await reply(deps, chatId, menuText());
  return true;
}
