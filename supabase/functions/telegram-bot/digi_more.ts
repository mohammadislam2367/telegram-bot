/**
 * 🛠 صفحه‌های «بیشتر» پنل اسپیکسل — هم‌ردهٔ بخش‌های دیجی‌انتی:
 * پاک‌سازی گروه، تنظیمات ضد فلوود و قالب‌های خوش‌آمد.
 *
 * کال‌بک‌ها:
 *   dg:more              فهرست این بخش
 *   dg:pg                صفحهٔ پاک‌سازی
 *   dg:pgd:<n>           پاک کردن n پیام قبل از همین پیام پنل
 *   dg:fl                صفحهٔ ضد فلوود
 *   dg:fls:<l|w>:<+|->   زیاد/کم کردن حد پیام یا بازهٔ زمانی
 *   dg:wl                صفحهٔ خوش‌آمد
 *   dg:wt:<index>        گذاشتن قالب خوش‌آمد
 *   dg:wg                روشن/خاموش کردن خوش‌آمد
 */
import { keyboard } from "../_shared/keyboards.ts";
import { faNum } from "../_shared/texts.ts";
import type { GroupSettingsRow } from "../_shared/types.ts";
import { escapeHtml } from "../_shared/validation.ts";
import { digiCard, type DigiDeps, saveSettings } from "./digi_core.ts";

type Btn = {
  text: string;
  callback_data?: string;
  url?: string;
  style?: "primary" | "success" | "danger";
};

export type PanelUi = {
  show(text: string, markup: unknown): Promise<void>;
  reply(text: string, alert?: boolean): Promise<void>;
};

const on = (value: boolean) => value ? "🟢" : "🔴";

function backRow(target = "dg:more"): Btn[] {
  return [
    { text: "↩️ بازگشت", callback_data: target, style: "primary" },
    { text: "❌ بستن", callback_data: "dg:q", style: "danger" },
  ];
}

/** قالب‌های آمادهٔ خوش‌آمد با متغیرهای دیجی. */
export const WELCOME_TEMPLATES: readonly { label: string; text: string }[] = [
  {
    label: "🎗 کلاسیک",
    text: "👋 {name} عزیز به {group} خوش آمدی!\n🕒 {TIME} · 📅 {DATE}",
  },
  {
    label: "✨ معرفی",
    text: "✨ {name} خوش آمدی!\n🔗 خودت را معرفی کن: نام / سن / شهر",
  },
  {
    label: "🏷 کارتی",
    text: "🎗 <b>{FIRST_NAME}</b> به {group} پیوست\n🧑 شناسه: <code>{USERID}</code>\n🕒 {DATE_TIME}",
  },
];

const FLOOD_LIMITS: readonly number[] = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 60];
const FLOOD_WINDOWS: readonly number[] = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600];

/** نزدیک‌ترین گام به مقدار فعلی؛ تا وقتی DB مقدار غیراستاندارد داشته باشد. */
function stepIndex(steps: readonly number[], current: number): number {
  const exact = steps.indexOf(current);
  if (exact !== -1) return exact;
  const above = steps.findIndex((step) => step >= current);
  return above === -1 ? steps.length - 1 : above;
}

export function moreScreen(settings: GroupSettingsRow): string {
  return digiCard("🛠 <b>بیشتر</b>", [
    `🧹 پاک‌سازی: حذف پیام‌های قبلی گروه`,
    `🌊 ضد فلوود: ${on(settings.antispam_enabled)} ${faNum(settings.flood_limit)} پیام در ${
      faNum(settings.flood_window_seconds)
    } ثانیه`,
    `👋 خوش‌آمد: ${on(settings.welcome_enabled)}`,
    "",
    "بخش مورد نظر را انتخاب کن.",
  ]);
}

export function moreMarkup(): unknown {
  return keyboard([
    [
      { text: "🧹 پاک‌سازی", callback_data: "dg:pg", style: "success" },
      { text: "🌊 ضد فلوود", callback_data: "dg:fl", style: "primary" },
    ],
    [{ text: "👋 خوش‌آمد و قالب‌ها", callback_data: "dg:wl", style: "primary" }],
    backRow("dg:m"),
  ]);
}

export function purgeScreen(deleted?: number): string {
  return digiCard("🧹 <b>پاک‌سازی گروه</b>", [
    deleted === undefined ? "چند پیام آخر گروه پاک شود؟" : `✅ ${faNum(deleted)} پیام پاک شد.`,
    "پیام‌ها از همین پیام پنل به عقب حذف می‌شوند.",
    "<i>تلگرام حذف پیام‌های قدیمی‌تر از ۴۸ ساعت را اجازه نمی‌دهد.</i>",
  ]);
}

export function purgeMarkup(): unknown {
  return keyboard([
    [
      { text: "🗑 ۱۰ پیام", callback_data: "dg:pgd:10", style: "danger" },
      { text: "🗑 ۵۰ پیام", callback_data: "dg:pgd:50", style: "danger" },
    ],
    [{ text: "🗑 ۱۰۰ پیام", callback_data: "dg:pgd:100", style: "danger" }],
    backRow(),
  ]);
}

export function floodScreen(settings: GroupSettingsRow): string {
  return digiCard("🌊 <b>ضد فلوود و اسپم</b>", [
    `وضعیت: ${on(settings.antispam_enabled)}`,
    `حد پیام: <b>${faNum(settings.flood_limit)}</b> پیام`,
    `بازهٔ زمانی: <b>${faNum(settings.flood_window_seconds)}</b> ثانیه`,
    "",
    "اگر عضوی در این بازه بیشتر از حد پیام بفرستد، پیام‌های اضافه حذف و اخطار ثبت می‌شود.",
  ]);
}

export function floodMarkup(settings: GroupSettingsRow): unknown {
  return keyboard([
    [
      { text: "➖ حد", callback_data: "dg:fls:l:-", style: "danger" },
      { text: `${faNum(settings.flood_limit)} پیام`, callback_data: "dg:fl", style: "primary" },
      { text: "➕ حد", callback_data: "dg:fls:l:+", style: "success" },
    ],
    [
      { text: "➖ بازه", callback_data: "dg:fls:w:-", style: "danger" },
      {
        text: `${faNum(settings.flood_window_seconds)} ثانیه`,
        callback_data: "dg:fl",
        style: "primary",
      },
      { text: "➕ بازه", callback_data: "dg:fls:w:+", style: "success" },
    ],
    backRow(),
  ]);
}

export function welcomeScreen(settings: GroupSettingsRow): string {
  return digiCard("👋 <b>خوش‌آمد</b>", [
    `وضعیت: ${on(settings.welcome_enabled)}`,
    "",
    "متن فعلی:",
    `<i>${escapeHtml(settings.welcome_text)}</i>`,
    "",
    "متغیرها: <code>{name}</code> · <code>{group}</code> · <code>{TIME}</code> · " +
    "<code>{DATE}</code> · <code>{USERID}</code> · <code>{FIRST_NAME}</code>",
    "قالب دلخواه: <code>خوشامد متن …</code>",
  ]);
}

export function welcomeMarkup(settings: GroupSettingsRow): unknown {
  const rows: Btn[][] = [
    [{
      text: `${settings.welcome_enabled ? "🟢 روشن" : "🔴 خاموش"} — خوش‌آمد`,
      callback_data: "dg:wg",
      style: settings.welcome_enabled ? "success" : "danger",
    }],
  ];
  WELCOME_TEMPLATES.forEach((template, index) => {
    rows.push([{
      text: `📄 ${template.label}`,
      callback_data: `dg:wt:${index}`,
      style: "primary",
    }]);
  });
  rows.push(backRow());
  return keyboard(rows);
}

/** هندلر این بخش؛ true یعنی کال‌بک مصرف شد. */
export async function handleMoreAction(
  deps: DigiDeps,
  chatId: number,
  settings: GroupSettingsRow,
  action: string,
  parts: string[],
  ui: PanelUi,
  messageId?: number,
): Promise<boolean> {
  if (action === "more") {
    await ui.show(moreScreen(settings), moreMarkup());
    return true;
  }

  if (action === "pg") {
    await ui.show(purgeScreen(), purgeMarkup());
    return true;
  }

  if (action === "pgd") {
    const requested = Math.max(1, Math.min(100, Number(parts[2]) || 10));
    let deleted = 0;
    if (messageId) {
      for (let index = 1; index <= requested; index++) {
        const id = messageId - index;
        if (id <= 0) break;
        try {
          await deps.tg.deleteMessage(chatId, id);
          deleted++;
        } catch {
          // پیام قدیمی یا از قبل حذف‌شده
        }
      }
    }
    await ui.reply(`🧹 ${faNum(deleted)} پیام پاک شد.`);
    await ui.show(purgeScreen(deleted), purgeMarkup());
    return true;
  }

  if (action === "fl") {
    await ui.show(floodScreen(settings), floodMarkup(settings));
    return true;
  }

  if (action === "fls") {
    const kind = parts[2] === "w" ? "w" : "l";
    const direction = parts[3] === "+" ? 1 : -1;
    const steps = kind === "w" ? FLOOD_WINDOWS : FLOOD_LIMITS;
    const current = kind === "w" ? settings.flood_window_seconds : settings.flood_limit;
    const index = Math.max(0, Math.min(steps.length - 1, stepIndex(steps, current) + direction));
    const value = steps[index];
    const patch = kind === "w" ? { flood_window_seconds: value } : { flood_limit: value };
    await saveSettings(deps, chatId, patch);
    await ui.reply(kind === "w" ? `⏱ بازه: ${faNum(value)} ثانیه` : `🌊 حد: ${faNum(value)} پیام`);
    const next = { ...settings, ...patch } as GroupSettingsRow;
    await ui.show(floodScreen(next), floodMarkup(next));
    return true;
  }

  if (action === "wl") {
    await ui.show(welcomeScreen(settings), welcomeMarkup(settings));
    return true;
  }

  if (action === "wg") {
    const enabled = !settings.welcome_enabled;
    await saveSettings(deps, chatId, { welcome_enabled: enabled });
    await ui.reply(enabled ? "خوش‌آمد روشن شد" : "خوش‌آمد خاموش شد");
    const next = { ...settings, welcome_enabled: enabled };
    await ui.show(welcomeScreen(next), welcomeMarkup(next));
    return true;
  }

  if (action === "wt") {
    const template = WELCOME_TEMPLATES[Number(parts[2])];
    if (!template) {
      await ui.reply("این قالب شناخته نشد.", true);
      return true;
    }
    await saveSettings(deps, chatId, { welcome_text: template.text });
    await ui.reply(`قالب «${template.label}» ثبت شد.`);
    const next = { ...settings, welcome_text: template.text };
    await ui.show(welcomeScreen(next), welcomeMarkup(next));
    return true;
  }

  return false;
}
