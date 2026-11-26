/**
 * 🎛 خانهٔ پنل گروه — نسخهٔ مرتب و کوتاه.
 *
 * چرا جدا از `digi_panel.ts`؟ چون آن فایل صفحه‌های داخلی (قفل‌ها، مجازات، …) را
 * نگه می‌دارد و ما فقط «صفحهٔ اول» را بازطراحی می‌کنیم؛ این‌طور هیچ بخشی از پنل
 * قدیمی خراب نمی‌شود و مسیر همهٔ دکمه‌ها همان `dg:*` قبلی می‌ماند.
 */
import { keyboard } from "../_shared/keyboards.ts";
import { faNum } from "../_shared/texts.ts";
import type { GroupSettingsRow, TgCallbackQuery, TgMessage } from "../_shared/types.ts";
import { escapeHtml } from "../_shared/validation.ts";
import { LOCK_DEFS, normalizeLocks } from "./locks.ts";
import { digiCard, type DigiDeps, isAdmin, loadSettings, normalize, say } from "./digi_core.ts";

type Btn = {
  text: string;
  callback_data?: string;
  url?: string;
  style?: "primary" | "success" | "danger";
};

const ON = "🟢";
const OFF = "🔴";
const PANEL_WORDS = ["پنل", "panel"];

function actionFa(action: string): string {
  if (action === "kick") return "اخراج";
  if (action === "ban") return "بن";
  return "سکوت";
}

/** کارت صفحهٔ اول پنل گروه. */
export function panelCard(settings: GroupSettingsRow | null, groupTitle: string): string {
  const locks = settings ? normalizeLocks(settings.locks) : {};
  const active = Object.values(locks).filter(Boolean).length;
  const total = LOCK_DEFS.length;
  const warnLimit = settings ? faNum(settings.warn_limit) : "—";
  const warnAction = settings ? actionFa(settings.warn_action) : "—";

  return digiCard(
    "🎛 <b>پنل مدیریت گروه</b>",
    [
      `👥 <b>${escapeHtml(groupTitle)}</b>`,
      "",
      `🔐 قفل‌ها: ${active > 0 ? ON : OFF} <b>${faNum(active)}</b> از ${faNum(total)}`,
      `🔗 ضدلینک: ${ON} ${settings?.antilink_enabled ? "روشن" : "خاموش"} · ${
        settings?.antispam_enabled ? ON : OFF
      } ضداسپم`,
      `📤 ضدفوروارد: ${settings?.block_forwards ? ON : OFF} · ✅ تأیید عضو: ${
        settings?.verify_enabled ? ON : OFF
      }`,
      `⚠️ مجازات: ${warnLimit} اخطار → ${warnAction}`,
      "",
      "<i>هر بخش را از دکمه‌های زیر باز کن؛ «بازگشت» همیشه به همین صفحه می‌آید.</i>",
    ].filter(Boolean),
  );
}

/** ترتیب دکمه‌ها: پرکاربردترین‌ها بالا، ناوبری پایین. */
export function panelButtons(): Btn[][] {
  return [
    [
      { text: "🔐 قفل‌ها", callback_data: "dg:l:0", style: "primary" },
      { text: "🧠 اتوماسیون", callback_data: "dg:a", style: "primary" },
    ],
    [
      { text: "⚠️ مجازات‌ها", callback_data: "dg:p", style: "primary" },
      { text: "🔤 فیلتر کلمات", callback_data: "dg:f", style: "primary" },
    ],
    [
      { text: "👮 مدیران", callback_data: "dg:s", style: "primary" },
      { text: "📊 آمار گروه", callback_data: "dg:st", style: "success" },
    ],
    [
      { text: "🎉 سرگرمی", callback_data: "dg:u", style: "primary" },
      { text: "📜 قوانین", callback_data: "dg:gr", style: "success" },
    ],
    [
      { text: "🧹 ابزار و پاک‌سازی", callback_data: "dg:more", style: "primary" },
      { text: "ℹ️ راهنما", callback_data: "dg:h", style: "primary" },
    ],
    [
      { text: "🔄 به‌روزرسانی", callback_data: "dg:m", style: "success" },
      { text: "❌ بستن", callback_data: "dg:q", style: "danger" },
    ],
  ];
}

function isGroupChat(type: string): boolean {
  return type === "group" || type === "supergroup";
}

/** «پنل» یا «/panel» در گروه → صفحهٔ تازه. */
export async function handlePanelHomeMessage(
  deps: DigiDeps,
  message: TgMessage,
): Promise<boolean> {
  const chat = message.chat;
  if (!isGroupChat(chat.type)) return false;
  const from = message.from;
  if (!from || from.is_bot) return false;

  const raw = (message.text ?? "").trim();
  if (!raw) return false;

  const isCommand = /^\/panel(@\w+)?\b/i.test(raw);
  if (!isCommand && !PANEL_WORDS.includes(normalize(raw))) return false;

  if (!(await isAdmin(deps, chat.id, from.id))) {
    await say(deps, chat.id, "⛔ این پنل فقط برای مدیران گروه است.");
    return true;
  }

  const settings = await loadSettings(deps, chat.id);
  await say(
    deps,
    chat.id,
    panelCard(settings, chat.title ?? "این گروه"),
    keyboard(panelButtons() as never),
  );
  return true;
}

/** دکمهٔ «🔄 به‌روزرسانی» و بازگشت به خانهٔ پنل. */
export async function handlePanelHomeCallback(
  deps: DigiDeps,
  cq: TgCallbackQuery,
): Promise<boolean> {
  const data = cq.data ?? "";
  if (data !== "dg:m") return false;

  const chat = cq.message?.chat;
  if (!chat || !isGroupChat(chat.type)) return false;
  if (!(await isAdmin(deps, chat.id, cq.from.id))) {
    try {
      await deps.tg.answerCallback(cq.id, "⛔ فقط مدیران گروه.", true);
    } catch {
      // callback قدیمی
    }
    return true;
  }

  const settings = await loadSettings(deps, chat.id);
  const text = panelCard(settings, chat.title ?? "این گروه");
  const markup = keyboard(panelButtons() as never);
  const messageId = cq.message?.message_id;

  try {
    await deps.tg.answerCallback(cq.id, "");
  } catch {
    // callback قدیمی
  }

  if (messageId) {
    try {
      await deps.tg.editMessageText(chat.id, messageId, text, { preview: false, markup });
      return true;
    } catch {
      // اگر ویرایش ممکن نبود، پیام تازه می‌فرستیم
    }
  }
  await deps.tg.sendMessage(chat.id, text, { preview: false, markup });
  return true;
}
