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

// وضعیت privacy را کوتاه کش می‌کنیم تا هر /start یک تماس اضافه نزند.
let privacyCache: { at: number; value: boolean | null } | null = null;
const PRIVACY_CACHE_MS = 300_000;

/** true یعنی ربات همهٔ پیام‌های گروه را می‌بیند (privacy mode خاموش است). */
async function readsAllGroupMessages(deps: IntroDeps): Promise<boolean | null> {
  if (privacyCache && Date.now() - privacyCache.at < PRIVACY_CACHE_MS) {
    return privacyCache.value;
  }
  try {
    const me = await deps.tg.getMe() as { can_read_all_group_messages?: boolean };
    const value = me.can_read_all_group_messages === true;
    privacyCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

function introText(readsAll: boolean | null): string {
  const lines = [
    sectionTitle("👋 ربات مدیریت این گروه، آماده است"),
    divider(),
    "🛡 ضد لینک و ضد اسپم  •  📤 ضد فوروارد",
    "⚠️ اخطار خودکار ← سکوت / اخراج / بن",
    "🔒 قفل گروه  •  📌 سنجاق  •  🧹 پاک‌سازی",
    "👋 خوش‌آمدگویی ویژهٔ اعضای تازه",
    "⚡ جواب فوری کلمات: بیو، ساعت، تاریخ، آیدی، تاس، جمله، پیشنهاد انیمه",
    "",
    "<b>دستورها:</b> /panel · /rules · /id · /report",
  ];
  if (readsAll === false) {
    lines.push(
      "",
      "⚠️ <b>یک تنظیم مهم برای مدیر:</b>",
      "ربات الان فقط دستورها و منشن‌ها را می‌بیند.",
      "برای فعال‌شدن ضدلینک، ضداسپم و پاسخ به کلمات آماده در همهٔ پیام‌ها:",
      "1️⃣ در BotFather دستور <code>/setprivacy</code> را بزن",
      "2️⃣ ربات را انتخاب کن و <b>Disable</b> را بزن",
      "3️⃣ ربات را از گروه حذف و دوباره اضافه کن",
    );
  }
  lines.push("", "<i>تنظیمات کامل گروه همین‌جا با /panel و دکمهٔ زیر انجام می‌شود.</i>");
  return lines.join("\n");
}

export async function handleGroupIntro(deps: IntroDeps, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;

  const text = (message.text ?? "").trim();
  if (!isIntroCommand(text, deps.cfg.botUsername)) return false;

  const username = deps.cfg.botUsername;
  const readsAll = await readsAllGroupMessages(deps);
  const markup = keyboard([
    [
      { text: "🛡 پنل مدیریت گروه", callback_data: "gp:p:1", style: "success" },
      { text: "🤖 ورود به ربات", url: `https://t.me/${username}?start=group` },
    ],
    [
      { text: "📜 قوانین گروه", url: `https://t.me/${username}?start=rules` },
      { text: "⚙️ تنظیمات گروه", url: `https://t.me/${username}?start=admin` },
    ],
  ]);

  try {
    await deps.tg.sendMessage(chat.id, introText(readsAll), { markup, preview: false });
  } catch (error) {
    await deps.log.warn("group intro failed", {
      chatId: chat.id,
      error: (error as Error).message,
    });
  }

  return true;
}
