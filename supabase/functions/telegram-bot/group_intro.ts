/**
 * 👋 پاسخ استارت در گروه — وقتی کاربر دکمهٔ «شروع» را در گروه می‌زند یا
 * /start و /help می‌فرستد، پیام کوتاه راهنما با دکمه‌های ورود به ربات می‌گیرد.
 * بدون این مسیر، دستور استارت در گروه بی‌صدا رد می‌شد.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../_shared/config.ts";
import type { TelegramApi } from "../_shared/telegram.ts";
import type { Logger } from "../_shared/logger.ts";
import type { TgMessage } from "../_shared/types.ts";
import { keyboard } from "../_shared/keyboards.ts";
import { divider, sectionTitle } from "../_shared/texts.ts";

export interface IntroDeps {
  cfg: AppConfig;
  sb: SupabaseClient;
  tg: TelegramApi;
  log: Logger;
}

const INTRO_COMMANDS = ["start", "help", "menu"];

/** آیا این متن، دستور استارت/راهنما خطاب به همین ربات است؟ */
export function isIntroCommand(text: string, botUsername: string): boolean {
  const match = text.trim().match(/^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,32}))?(?:\s|$)/);
  if (!match) return false;
  const [, name, mention] = match;
  if (mention && mention.toLowerCase() !== botUsername.toLowerCase()) return false;
  return INTRO_COMMANDS.includes(name.toLowerCase());
}

function introText(): string {
  return [
    sectionTitle("👋 سلام! من ربات مدیریت این گروه هستم"),
    divider(),
    "• ضدلینک، ضداسپم و ضد فوروارد",
    "• اخطار، سکوت و بن خودکار",
    "• خوش‌آمدگویی و قوانین",
    "",
    "<b>دستورها:</b>",
    "• /rules — قوانین گروه",
    "• /id — شناسهٔ من و گروه",
    "• /report — گزارش تخلف (با ریپلای روی پیام)",
    "• /quiz، /dice، /coin، /rps — بازی و سرگرمی",
    "",
    "<i>تنظیمات کامل گروه در چت خصوصی ربات انجام می‌شود.</i>",
  ].join("\n");
}

export async function handleGroupIntro(deps: IntroDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;

  const text = (message.text ?? "").trim();
  if (!isIntroCommand(text, deps.cfg.botUsername)) return false;

  const username = deps.cfg.botUsername;
  const markup = keyboard([
    [
      { text: "🤖 ورود به ربات", url: `https://t.me/${username}?start=group` },
      { text: "⚙️ تنظیمات گروه", url: `https://t.me/${username}?start=admin` },
    ],
  ]);

  try {
    await deps.tg.sendMessage(chat.id, introText(), { markup, preview: false });
  } catch (error) {
    await deps.log.warn("group intro failed", {
      chatId: chat.id,
      error: (error as Error).message,
    });
  }

  return true;
}
