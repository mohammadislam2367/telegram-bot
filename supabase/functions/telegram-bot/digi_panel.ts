/**
 * 🎛 پنل دیجی‌انتی‌وار — همهٔ بخش‌ها با دکمه‌های شیشه‌ای.
 *
 * ساختار callback ها: `dg:<section>[:arg]`
 *   dg:m            صفحهٔ اصلی پنل گروه
 *   dg:l:<page>     فهرست قفل‌ها (صفحه‌بندی)
 *   dg:t:<key>:<p>  روشن/خاموش کردن یک قفل
 *   dg:a            اتوماسیون (ضدلینک، ضداسپم، ضدفوروارد، خوشامد، تأیید، سخت‌گیرانه)
 *   dg:x:<field>    سوییچ یک فیلد بولی
 *   dg:p            مجازات‌ها (سقف اخطار، نوع مجازات، مدت سکوت)
 *   dg:s / dg:f     کاربران مدیر و ویژه / فیلتر کلمات
 *   dg:st           آمار گروه
 *   dg:u            سرگرمی
 *   dg:h / dg:gr    راهنما / قوانین
 */
import { countRows, deleteRows, selectRows } from "../_shared/db.ts";
import { keyboard, urlButton } from "../_shared/keyboards.ts";
import { faNum } from "../_shared/texts.ts";
import type { GroupSettingsRow, TgCallbackQuery, TgMessage } from "../_shared/types.ts";
import { escapeHtml } from "../_shared/validation.ts";
import { LOCK_DEFS, normalizeLocks } from "./locks.ts";
import {
  applyPermissions,
  digiCard,
  type DigiDeps,
  FUN_TRIGGERS,
  funCard,
  helpCard,
  isAdmin,
  loadSettings,
  saveSettings,
} from "./digi_core.ts";

type Btn = {
  text: string;
  callback_data?: string;
  url?: string;
  style?: "primary" | "success" | "danger";
};

const on = (value: boolean) => value ? "🟢" : "🔴";
const PAGE_SIZE = 10;

function backRow(target = "dg:m"): Btn[] {
  return [
    { text: "↩️ بازگشت", callback_data: target, style: "primary" },
    { text: "❌ بستن", callback_data: "dg:q", style: "danger" },
  ];
}

async function adminOnly(deps: DigiDeps, chatId: number, userId: number): Promise<boolean> {
  return await isAdmin(deps, chatId, userId);
}

/** صفحهٔ اصلی پنل گروه. */
export function mainScreen(settings: GroupSettingsRow): string {
  const locks = normalizeLocks(settings.locks);
  const active = Object.values(locks).filter(Boolean).length;
  return digiCard("🛡 <b>پنل مدیریت اسپیکسل</b>", [
    `١. قفل‌ها: ${on(active > 0)} ${faNum(active)} فعال از ${faNum(LOCK_DEFS.length)}`,
    `٢. اتوماسیون: ضدلینک ${on(settings.antilink_enabled)} · ضداسپم ${on(settings.antispam_enabled)}`,
    `٣. خوشامد ${on(settings.welcome_enabled)} · ضدفوروارد ${on(settings.block_forwards)}`,
    `٤. تأیید ${on(settings.verify_enabled)} · سخت‌گیرانه ${on(settings.strict_mode)}`,
    `٥. مجازات: ${faNum(settings.warn_limit)} اخطار → ${faAction(settings.warn_action)}`,
    "",
    "بخش مورد نظر را از دکمه‌ها انتخاب کن.",
  ]);
}

function faAction(action: string): string {
  if (action === "kick") return "اخراج";
  if (action === "ban") return "بن";
  return "سکوت";
}

export function mainMarkup(isGroup: boolean): unknown {
  const rows: Btn[][] = [
    [
      { text: "🔐 قفل‌ها", callback_data: "dg:l:0", style: "success" },
      { text: "🧠 اتوماسیون", callback_data: "dg:a", style: "primary" },
    ],
    [
      { text: "⚠️ مجازات‌ها", callback_data: "dg:p", style: "primary" },
      { text: "👮 مدیران", callback_data: "dg:s", style: "primary" },
    ],
    [
      { text: "🔤 فیلتر کلمات", callback_data: "dg:f", style: "primary" },
      { text: "📊 آمار", callback_data: "dg:st", style: "success" },
    ],
    [
      { text: "🎉 سرگرمی", callback_data: "dg:u", style: "success" },
      { text: "📜 قوانین", callback_data: "dg:gr", style: "primary" },
    ],
    [
      { text: "ℹ️ راهنما", callback_data: "dg:h", style: "primary" },
      { text: "❌ بستن", callback_data: "dg:q", style: "danger" },
    ],
  ];
  if (!isGroup) {
    rows.push([{ text: "➕ افزودن به گروه", callback_data: "dg:grp", style: "success" }]);
  }
  return keyboard(rows);
}

export function locksText(settings: GroupSettingsRow, page: number): {
  text: string;
  markup: unknown;
} {
  const locks = normalizeLocks(settings.locks);
  const pages = Math.ceil(LOCK_DEFS.length / PAGE_SIZE);
  const safePage = Math.max(0, Math.min(page, pages - 1));
  const slice = LOCK_DEFS.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rows: Btn[][] = [];
  for (let i = 0; i < slice.length; i += 2) {
    rows.push(slice.slice(i, i + 2).map((def) => ({
      text: `${locks[def.key] ? "✅" : "🔒"} ${def.emoji} ${def.label}`,
      callback_data: `dg:t:${def.key}:${safePage}`,
      style: locks[def.key] ? ("success" as const) : ("primary" as const),
    })));
  }
  const nav: Btn[] = [];
  if (safePage > 0) nav.push({ text: "◀️", callback_data: `dg:l:${safePage - 1}`, style: "primary" });
  nav.push({
    text: `صفحهٔ ${faNum(safePage + 1)}/${faNum(pages)}`,
    callback_data: `dg:l:${safePage}`,
    style: "primary",
  });
  if (safePage < pages - 1) {
    nav.push({ text: "▶️", callback_data: `dg:l:${safePage + 1}`, style: "primary" });
  }
  rows.push(nav);
  rows.push([
    { text: "🔴 همه بسته", callback_data: "dg:la:off", style: "danger" },
    { text: "🟢 همه باز", callback_data: "dg:la:on", style: "success" },
  ]);
  rows.push(backRow());

  const text = digiCard("🔐 <b>قفل‌های گروه</b>", [
    `فعال: <b>${faNum(Object.values(locks).filter(Boolean).length)}</b> از ${faNum(LOCK_DEFS.length)}`,
    "روی هر دکمه بزن تا همان قفل روشن/خاموش شود.",
    "",
    "دستور متنی: <code>قفل لینک</code> · <code>بازکردن لینک</code> · <code>قفل ها</code>",
  ]);
  return { text, markup: keyboard(rows) };
}

function antiText(settings: GroupSettingsRow): { text: string; markup: unknown } {
  const items: [string, string, boolean][] = [
    ["antilink_enabled", "🔗 ضدلینک", settings.antilink_enabled],
    ["antispam_enabled", "🧹 ضدتبچی/اسپم", settings.antispam_enabled],
    ["block_forwards", "📤 ضدفوروارد", settings.block_forwards],
    ["welcome_enabled", "👋 خوشامد", settings.welcome_enabled],
    ["verify_enabled", "✅ تأیید هویت", settings.verify_enabled],
    ["strict_mode", "🛡 حالت سخت‌گیرانه", settings.strict_mode],
    ["delete_warn_messages", "🗑 حذف پیام اخطارها", settings.delete_warn_messages],
  ];
  const rows: Btn[][] = items.map(([field, label, value]) => [{
    text: `${value ? "🟢" : "🔴"} ${label}`,
    callback_data: `dg:x:${field}`,
    style: value ? ("success" as const) : ("danger" as const),
  }]);
  rows.push(backRow());
  return {
    text: digiCard("🧠 <b>اتوماسیون گروه</b>", [
      "هر دکمه را بزن تا فوراً روشن/خاموش شود.",
      "",
      `خوشامد: ${on(settings.welcome_enabled)} · متن خوشامد: <code>خوشامد متن …</code>`,
      `تأیید هویت: ${on(settings.verify_enabled)} · سخت‌گیرانه: ${on(settings.strict_mode)}`,
    ]),
    markup: keyboard(rows),
  };
}

function punishText(settings: GroupSettingsRow): { text: string; markup: unknown } {
  const next = settings.warn_action === "mute"
    ? "kick"
    : settings.warn_action === "kick"
    ? "ban"
    : "mute";
  return {
    text: digiCard("⚠️ <b>مجازات‌ها</b>", [
      `سقف اخطار: <b>${faNum(settings.warn_limit)}</b>`,
      `مجازات: <b>${faAction(settings.warn_action)}</b>`,
      `مدت سکوت: <b>${faNum(settings.mute_duration_minutes)}</b> دقیقه`,
    ]),
    markup: keyboard([
      [
        { text: "➖ اخطار", callback_data: "dg:w:-", style: "danger" },
        { text: `سقف: ${faNum(settings.warn_limit)}`, callback_data: "dg:p", style: "primary" },
        { text: "➕ اخطار", callback_data: "dg:w:+", style: "success" },
      ],
      [{ text: `🔄 مجازات: ${faAction(next)}`, callback_data: `dg:wa:${next}`, style: "primary" }],
      [
        { text: "➖ مدت", callback_data: "dg:mu:-", style: "danger" },
        {
          text: `${faNum(settings.mute_duration_minutes)} دقیقه`,
          callback_data: "dg:p",
          style: "primary",
        },
        { text: "➕ مدت", callback_data: "dg:mu:+", style: "success" },
      ],
      backRow(),
    ]),
  };
}

type StaffRow = { user_id: number; role: string; title: string | null };

async function staffScreen(
  deps: DigiDeps,
  chatId: number,
): Promise<{ text: string; markup: unknown }> {
  let rowsModel: StaffRow[] = [];
  try {
    rowsModel = await selectRows<StaffRow>(
      deps.sb,
      "group_staff",
      (q) => q.eq("group_id", chatId).limit(30),
    );
  } catch {
    rowsModel = [];
  }
  const admins = rowsModel.filter((row) => row.role === "admin");
  const vips = rowsModel.filter((row) => row.role === "vip");
  const line = (row: StaffRow) =>
    `• <code>${row.user_id}</code>${row.title ? ` — ${escapeHtml(row.title)}` : ""}`;
  return {
    text: digiCard("👮 <b>کاربران مدیر و ویژه</b>", [
      `مدیران (${faNum(admins.length)}):`,
      ...(admins.length ? admins.slice(0, 10).map(line) : ["— هیچ مدیری ثبت نشده"]),
      "",
      `ویژه‌ها (${faNum(vips.length)}):`,
      ...(vips.length ? vips.slice(0, 10).map(line) : ["— هیچ کاربر ویژه‌ای ثبت نشده"]),
      "",
      "افزودن: روی کاربر ریپلای کن و بنویس <code>افزودن مدیر</code> یا <code>افزودن ویژه</code>",
    ]),
    markup: keyboard([
      [
        { text: "🔄 به‌روزرسانی", callback_data: "dg:s", style: "primary" },
        { text: "📋 فهرست دستورها", callback_data: "dg:h", style: "success" },
      ],
      backRow(),
    ]),
  };
}

async function filterScreen(
  deps: DigiDeps,
  chatId: number,
): Promise<{ text: string; markup: unknown }> {
  let words: { id: number; word: string }[] = [];
  try {
    words = await selectRows<{ id: number; word: string }>(
      deps.sb,
      "group_words",
      (q) => q.eq("group_id", chatId).limit(20),
    );
  } catch {
    words = [];
  }
  const rows: Btn[][] = [];
  for (let i = 0; i < words.length; i += 2) {
    rows.push(words.slice(i, i + 2).map((row) => ({
      text: `🗑 ${row.word.slice(0, 14)}`,
      callback_data: `dg:fr:${row.id}`,
      style: "danger" as const,
    })));
  }
  rows.push([
    { text: "🔄 به‌روزرسانی", callback_data: "dg:f", style: "primary" },
    { text: "➕ نحوهٔ افزودن", callback_data: "dg:fh", style: "success" },
  ]);
  rows.push(backRow());
  return {
    text: digiCard("🔤 <b>فیلتر کلمات</b>", [
      `تعداد کلمه‌های فیلترشده: <b>${faNum(words.length)}</b>`,
      words.length ? "برای حذف هر کلمه روی دکمهٔ آن بزن." : "هنوز کلمه‌ای ثبت نشده.",
      "",
      "افزودن: <code>فیلتر کردن کلمه</code> · حذف: <code>حذف فیلتر کلمه</code>",
    ]),
    markup: keyboard(rows),
  };
}

async function statsScreen(
  deps: DigiDeps,
  chatId: number,
  settings: GroupSettingsRow,
): Promise<{ text: string; markup: unknown }> {
  const locks = normalizeLocks(settings.locks);
  const safeCount = async (table: string, extra: Record<string, unknown> = {}) => {
    try {
      return await countRows(deps.sb, table, (q) => {
        // deno-lint-ignore no-explicit-any
        let query: any = q.eq("group_id", chatId);
        for (const [column, value] of Object.entries(extra)) query = query.eq(column, value);
        return query;
      });
    } catch {
      return 0;
    }
  };
  const staff = await safeCount("group_staff");
  const words = await safeCount("group_words");
  const warns = await safeCount("user_warnings", { is_active: true });
  const bans = await safeCount("group_bans", { is_active: true });
  let groups = 0;
  try {
    groups = await countRows(deps.sb, "group_settings");
  } catch {
    groups = 0;
  }
  const activeLocks = Object.values(locks).filter(Boolean).length;
  return {
    text: digiCard("📊 <b>آمار</b>", [
      `گروه‌های ثبت‌شده: <b>${faNum(groups)}</b>`,
      `قفل فعال: <b>${faNum(activeLocks)}</b>`,
      `کاربران مدیر/ویژه: <b>${faNum(staff)}</b>`,
      `کلمه‌های فیلتر: <b>${faNum(words)}</b>`,
      `اخطار فعال: <b>${faNum(warns)}</b> · بن/سکوت فعال: <b>${faNum(bans)}</b>`,
    ]),
    markup: keyboard([
      [
        { text: "🔄 به‌روزرسانی", callback_data: "dg:st", style: "primary" },
        { text: "🔐 قفل‌ها", callback_data: "dg:l:0", style: "success" },
      ],
      backRow(),
    ]),
  };
}

function funMarkup(): unknown {
  const rows: Btn[][] = [];
  FUN_TRIGGERS.forEach((trigger, index) => {
    const label = trigger === "فال حافظ"
      ? "🔮 فال حافظ"
      : trigger === "اخبار ایران"
      ? "📰 اخبار"
      : `🎉 ${trigger}`;
    if (index % 2 === 0) rows.push([]);
    rows[rows.length - 1].push({
      text: label,
      callback_data: `dg:fn:${index}`,
      style: index % 2 === 0 ? "success" : "primary",
    });
  });
  rows.push(backRow());
  return keyboard(rows);
}

/** هندلر همهٔ دکمه‌های `dg:` */
export async function handleDigiPanelCallback(
  deps: DigiDeps,
  cq: TgCallbackQuery,
): Promise<boolean> {
  const data = cq.data ?? "";
  if (!data.startsWith("dg:")) return false;

  const parts = data.split(":");
  const action = parts[1] ?? "";
  const chat = cq.message?.chat;
  const messageId = cq.message?.message_id;
  const isGroup = chat?.type === "group" || chat?.type === "supergroup";
  const chatId = chat?.id ?? cq.from.id;

  const reply = async (text: string, alert = false) => {
    try {
      await deps.tg.answerCallback(cq.id, text, alert);
    } catch {
      // callback قدیمی
    }
  };

  const show = async (text: string, markup: unknown) => {
    if (chat && messageId) {
      try {
        await deps.tg.editMessageText(chat.id, messageId, text, {
          preview: false,
          markup: markup as never,
        });
        return;
      } catch {
        // اگر ویرایش ممکن نبود پیام تازه بفرست
      }
    }
    await deps.tg.sendMessage(chatId, text, { preview: false, markup: markup as never });
  };

  if (action === "q") {
    if (chat && messageId) {
      try {
        await deps.tg.deleteMessage(chat.id, messageId);
      } catch {
        // پیام حذف‌شده
      }
    }
    return true;
  }

  if (action === "h") {
    await show(
      helpCard(),
      keyboard([[{ text: "↩️ بازگشت", callback_data: "dg:m", style: "primary" }]]),
    );
    return true;
  }

  if (action === "about") {
    await show(
      digiCard("ℹ️ <b>دربارهٔ اسپیکسل</b>", [
        `ربات: @${deps.cfg.botUsername}`,
        "مدیریت گروه، قفل‌های تفکیکی، خوشامد، فیلتر کلمات و سرگرمی.",
        "دستورها بدون اسلش هم کار می‌کنند.",
      ]),
      keyboard([[{ text: "↩️ بازگشت", callback_data: "dg:m", style: "primary" }]]),
    );
    return true;
  }

  if (action === "grp") {
    await reply("ربات را از دکمهٔ پیام قبلی به گروه اضافه کن و ادمینش کن.", true);
    return true;
  }

  if (action === "ai") {
    await show(
      digiCard("🤖 <b>هوش مصنوعی</b>", [
        "برای چت هوشمند بنویس: <code>/ai سؤالت</code>",
        "پاسخ‌ها فقط وقتی می‌آیند که خودت بخواهی؛ ربات خودکار جواب نمی‌دهد.",
      ]),
      keyboard([[{ text: "↩️ بازگشت", callback_data: "dg:m", style: "primary" }]]),
    );
    return true;
  }

  if (action === "fn") {
    const trigger = FUN_TRIGGERS[Number(parts[2])];
    if (!trigger) {
      await reply("این دکمه معتبر نیست.");
      return true;
    }
    await show(funCard(trigger), keyboard([backRow("dg:u")]));
    return true;
  }

  if (action === "u") {
    await show(digiCard("🎉 <b>سرگرمی</b>", ["یکی را انتخاب کن:"]), funMarkup());
    return true;
  }

  if (!isGroup) {
    await reply("این بخش فقط در گروه کار می‌کند.", true);
    return true;
  }

  if (!(await adminOnly(deps, chatId, cq.from.id))) {
    await reply("⛔ فقط مدیران گروه.", true);
    return true;
  }

  const settings = await loadSettings(deps, chatId);
  if (!settings) {
    await reply("⚠️ تنظیمات گروه در دسترس نیست.", true);
    return true;
  }

  if (action === "m") {
    await show(mainScreen(settings), mainMarkup(true));
    return true;
  }

  if (action === "l") {
    const page = Number(parts[2] ?? 0) || 0;
    const view = locksText(settings, page);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "t") {
    const key = parts[2] ?? "";
    const page = Number(parts[3] ?? 0) || 0;
    const locks = normalizeLocks(settings.locks);
    if (!(key in locks)) {
      await reply("این قفل شناخته نشد.");
      return true;
    }
    locks[key] = !locks[key];
    await saveSettings(deps, chatId, { locks });
    if (key === "all" || ["photo", "video", "voice", "music", "sticker", "poll"].includes(key)) {
      try {
        await applyPermissions(deps, chatId, locks);
      } catch {
        // دسترسی ربات کافی نیست
      }
    }
    await reply(locks[key] ? "قفل شد" : "باز شد");
    const view = locksText({ ...settings, locks }, page);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "la") {
    const enable = parts[2] === "on";
    const locks = normalizeLocks(settings.locks);
    for (const key of Object.keys(locks)) locks[key] = enable;
    await saveSettings(deps, chatId, { locks });
    try {
      await applyPermissions(deps, chatId, locks);
    } catch {
      // دسترسی کافی نیست
    }
    await reply(enable ? "همهٔ قفل‌ها روشن شد" : "همهٔ قفل‌ها باز شد");
    const view = locksText({ ...settings, locks }, 0);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "a") {
    const view = antiText(settings);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "x") {
    const field = parts[2] ?? "";
    const allowed = [
      "antilink_enabled",
      "antispam_enabled",
      "block_forwards",
      "welcome_enabled",
      "verify_enabled",
      "strict_mode",
      "delete_warn_messages",
    ];
    if (!allowed.includes(field)) {
      await reply("این گزینه شناخته نشد.");
      return true;
    }
    const current = (settings as unknown as Record<string, unknown>)[field] === true;
    const patch = { [field]: !current } as Partial<GroupSettingsRow>;
    await saveSettings(deps, chatId, patch);
    await reply(!current ? "روشن شد" : "خاموش شد");
    const view = antiText({ ...settings, ...patch });
    await show(view.text, view.markup);
    return true;
  }

  if (action === "p") {
    const view = punishText(settings);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "w") {
    const delta = parts[2] === "+" ? 1 : -1;
    const limit = Math.max(1, Math.min(10, settings.warn_limit + delta));
    await saveSettings(deps, chatId, { warn_limit: limit });
    const view = punishText({ ...settings, warn_limit: limit });
    await show(view.text, view.markup);
    return true;
  }

  if (action === "wa") {
    const next = parts[2];
    const value = next === "kick" || next === "ban" ? next : "mute";
    await saveSettings(deps, chatId, { warn_action: value });
    const view = punishText({ ...settings, warn_action: value });
    await show(view.text, view.markup);
    return true;
  }

  if (action === "mu") {
    const steps = [1, 5, 10, 15, 30, 60, 120, 1440];
    const delta = parts[2] === "+" ? 1 : -1;
    const index = Math.max(
      0,
      Math.min(steps.length - 1, steps.indexOf(settings.mute_duration_minutes) + delta),
    );
    const minutes = steps[index] ?? 30;
    await saveSettings(deps, chatId, { mute_duration_minutes: minutes });
    const view = punishText({ ...settings, mute_duration_minutes: minutes });
    await show(view.text, view.markup);
    return true;
  }

  if (action === "s") {
    const view = await staffScreen(deps, chatId);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "f") {
    const view = await filterScreen(deps, chatId);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "fh") {
    await reply("در گروه بنویس: فیلتر کردن <کلمه>", true);
    return true;
  }

  if (action === "fr") {
    const id = Number(parts[2]);
    if (!Number.isSafeInteger(id)) {
      await reply("این دکمه معتبر نیست.");
      return true;
    }
    try {
      await deleteRows(deps.sb, "group_words", { id });
      await reply("کلمه حذف شد");
    } catch {
      await reply("حذف انجام نشد", true);
    }
    const view = await filterScreen(deps, chatId);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "st") {
    const view = await statsScreen(deps, chatId, settings);
    await show(view.text, view.markup);
    return true;
  }

  if (action === "gr") {
    const body = (settings.rules_text ?? "").trim() ||
      "قوانینی ثبت نشده است. مدیر می‌تواند بنویسد: <code>پیکربندی متن قوانین</code>";
    await reply("قوانین ارسال شد.");
    await deps.tg.sendMessage(chatId, digiCard("📜 <b>قوانین گروه</b>", [body]), {
      preview: false,
      markup: keyboard([backRow("dg:m")]) as never,
    });
    return true;
  }

  await reply("این دکمه پشتیبانی نمی‌شود.");
  return true;
}

/** پیام‌های ورودی پنل: `/start` و «پنل» در چت خصوصی، «پنل» در گروه. */
export async function handleDigiPanelMessage(
  deps: DigiDeps,
  message: TgMessage,
): Promise<boolean> {
  const chat = message.chat;
  const from = message.from;
  if (!from || from.is_bot) return false;
  const raw = (message.text ?? "").trim();
  if (!raw) return false;

  const isPrivate = chat.type === "private";
  const command = raw.startsWith("/") ? raw.split(/[\s@]/)[0].slice(1).toLowerCase() : "";
  const word = raw.replace(/^\/+/, "").trim().toLowerCase();

  const wantsPanel = isPrivate
    ? command === "start" || command === "panel" || word === "پنل" || word === "منو"
    : word === "پنل" || word === "panel";

  if (!wantsPanel) return false;

  if (isPrivate) {
    await deps.tg.sendMessage(
      chat.id,
      digiCard("🤖 <b>اسپیکسل</b>", [
        "دستیار و مدیر گروه، به سبک دیجی‌انتی.",
        "",
        "• <code>/ai سؤالت</code> — چت هوشمند",
        "• <code>راهنما</code> — همهٔ دستورها",
        "• در گروه بنویس <code>پنل</code> تا پنل مدیریت باز شود",
        "",
        "دکمه‌های زیر را بزن.",
      ]),
      {
        preview: false,
        markup: keyboard([
          [
            { text: "🧰 ابزارها", callback_data: "u:tb", style: "primary" },
            { text: "👤 بیو من", callback_data: "u:bi", style: "success" },
          ],
          [
            { text: "ℹ️ درباره", callback_data: "dg:about", style: "primary" },
            { text: "🤖 هوش مصنوعی", callback_data: "dg:ai", style: "success" },
          ],
          [
            urlButton(
              "➕ افزودن به گروه",
              `https://t.me/${deps.cfg.botUsername}?startgroup=true`,
              "success",
            ),
          ],
        ]) as never,
      },
    );
    return true;
  }

  if (!(await adminOnly(deps, chat.id, from.id))) {
    await deps.tg.sendMessage(chat.id, "⛔ این دستور فقط برای مدیران گروه است.", {
      preview: false,
    });
    return true;
  }

  const settings = await loadSettings(deps, chat.id);
  if (!settings) {
    await deps.tg.sendMessage(chat.id, "⚠️ تنظیمات گروه در دسترس نیست. بعداً تلاش کن.", {
      preview: false,
    });
    return true;
  }

  await deps.tg.sendMessage(chat.id, mainScreen(settings), {
    preview: false,
    markup: mainMarkup(true) as never,
  });
  return true;
}
