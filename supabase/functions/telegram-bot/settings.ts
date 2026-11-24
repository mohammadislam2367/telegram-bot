/** ⚙️ تنظیمات ربات — ویرایش بدون کد، ماژول‌ها و مدیریت مدیران. */
import { insertRow, selectOne, selectRows, updateRows } from "../_shared/db.ts";
import { type AdminRole, canManageRole, type Permission, ROLE_LABELS } from "../_shared/auth.ts";
import { type Button, keyboard } from "../_shared/keyboards.ts";
import { DEFAULT_SETTINGS, type SettingKey } from "../_shared/settings.ts";
import { divider, faDateTime, faNum, sectionTitle } from "../_shared/texts.ts";
import {
  escapeHtml,
  isValidUrl,
  parseChatTarget,
  parseTelegramId,
  sanitizeText,
  truncate,
} from "../_shared/validation.ts";
import type { AdminRow, UserRow } from "../_shared/types.ts";
import {
  loadCustomPresets,
  MAX_CUSTOM_PRESETS,
  MAX_PRESET_REPLY,
  PRESET_SETTINGS_KEY,
  sanitizePresetWord,
} from "../_shared/presets.ts";
import { invalidatePresetCache } from "./quick.ts";
import {
  answerCallback,
  askConfirm,
  askForInput,
  type Ctx,
  editOrSend,
  guardAdmin,
  logAdminAction,
  send,
} from "./context.ts";

const MODULE_KEYS: SettingKey[] = [
  "feature_ai",
  "feature_anime",
  "feature_news",
  "feature_ads",
  "feature_broadcast",
  "feature_content",
  "feature_groups",
  "feature_scheduling",
  "ai_enabled",
  "ai_memory_enabled",
  "ai_anime_context",
  "weekly_report_enabled",
  "daily_stats_enabled",
  "broadcast_require_confirm",
];

const LIMIT_KEYS: SettingKey[] = [
  "ai_daily_limit",
  "ai_group_daily_limit",
  "ai_group_cooldown_seconds",
  "ai_memory_messages",
  "ai_fallback_cooldown_seconds",
  "ai_max_retries",
  "broadcast_batch_size",
  "broadcast_delay_ms",
  "broadcast_max_fail_streak",
  "ads_min_interval_minutes",
  "session_ttl_minutes",
  "user_rate_limit_per_minute",
  "admin_rate_limit_per_minute",
  "data_retention_days",
  "weekly_report_day",
  "weekly_report_hour",
];

const NUMBER_RANGES: Partial<Record<SettingKey, [number, number]>> = {
  ai_daily_limit: [0, 1000],
  ai_group_daily_limit: [0, 100],
  ai_group_cooldown_seconds: [0, 3600],
  ai_memory_messages: [0, 50],
  ai_fallback_cooldown_seconds: [60, 86_400],
  ai_max_retries: [0, 3],
  broadcast_batch_size: [1, 50],
  broadcast_delay_ms: [0, 3000],
  broadcast_max_fail_streak: [5, 100],
  ads_min_interval_minutes: [0, 1440],
  session_ttl_minutes: [5, 1440],
  user_rate_limit_per_minute: [1, 120],
  admin_rate_limit_per_minute: [1, 300],
  data_retention_days: [7, 365],
  weekly_report_day: [0, 6],
  weekly_report_hour: [0, 23],
};

const KEY_LABELS: Partial<Record<SettingKey, string>> = {
  maintenance_mode: "حالت تعمیر",
  maintenance_text: "پیام تعمیر",
  welcome_text: "پیام خوش‌آمد",
  channel_target: "کانال انتشار",
  channel_url: "لینک کانال",
  group_url: "لینک گروه",
  support_username: "پشتیبانی",
  ads_label: "برچسب تبلیغ",
  ads_default_target: "مقصد پیش‌فرض تبلیغ",
  timezone: "منطقه زمانی",
  ai_enabled: "هوش مصنوعی",
  ai_daily_limit: "سقف روزانه AI",
  ai_group_daily_limit: "سقف روزانه AI در گروه",
  ai_group_cooldown_seconds: "فاصلهٔ پاسخ AI در گروه (ثانیه)",
  ai_memory_messages: "حافظه مکالمه",
  ai_memory_enabled: "حافظه فعال",
  ai_fallback_cooldown_seconds: "فاصلهٔ تلاش مجدد (ثانیه)",
  ai_max_retries: "تلاش مجدد AI",
  ai_model: "مدل AI",
  ai_persona: "شخصیت AI",
  ai_anime_context: "اطلاعات Jikan در AI",
  feature_ai: "ماژول AI",
  feature_anime: "ماژول انیمه",
  feature_news: "ماژول اخبار",
  feature_ads: "ماژول تبلیغات",
  feature_broadcast: "ارسال همگانی",
  feature_content: "ماژول محتوا",
  feature_groups: "مدیریت گروه",
  feature_scheduling: "زمان‌بندی",
  broadcast_batch_size: "اندازه دسته همگانی",
  broadcast_delay_ms: "فاصله ارسال (ms)",
  broadcast_max_fail_streak: "حد خطای پیاپی",
  broadcast_require_confirm: "تأیید اجباری همگانی",
  ads_min_interval_minutes: "فاصله تبلیغات (دقیقه)",
  session_ttl_minutes: "انقضای session",
  user_rate_limit_per_minute: "محدودیت کاربر/دقیقه",
  admin_rate_limit_per_minute: "محدودیت مدیر/دقیقه",
  data_retention_days: "نگه‌داری داده (روز)",
  weekly_report_enabled: "گزارش هفتگی",
  weekly_report_day: "روز گزارش (0=یکشنبه)",
  weekly_report_hour: "ساعت گزارش",
  daily_stats_enabled: "آمار روزانه",
};

function labelFor(key: SettingKey): string {
  return KEY_LABELS[key] ?? key;
}

/** کلیدهایی که از پنل «مدیریت هوش مصنوعی» ویرایش می‌شوند. */
const AI_PANEL_KEYS: string[] = [
  "ai_persona",
  "ai_model",
  "ai_daily_limit",
  "ai_group_daily_limit",
  "ai_group_cooldown_seconds",
  "ai_memory_messages",
];

function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "🟢 روشن" : "🔴 خاموش";
  if (typeof value === "number") return faNum(value);
  const text = String(value ?? "");
  return text.length === 0 ? "—" : escapeHtml(truncate(text, 60));
}

export function parseSettingValue(
  key: string,
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!(key in DEFAULT_SETTINGS)) return { ok: false, error: "کلید تنظیمات ناشناخته است." };
  const typedKey = key as SettingKey;
  const defaultValue = DEFAULT_SETTINGS[typedKey];
  const input = raw.trim();

  if (typeof defaultValue === "boolean") {
    const normalized = input.toLowerCase();
    if (["1", "on", "true", "yes", "روشن", "بله", "فعال"].includes(normalized)) {
      return { ok: true, value: true };
    }
    if (["0", "off", "false", "no", "خاموش", "خیر", "غیرفعال"].includes(normalized)) {
      return { ok: true, value: false };
    }
    return { ok: false, error: "مقدار باید روشن/خاموش باشد." };
  }

  if (typeof defaultValue === "number") {
    const value = Number(input.replace(/[^\d-]/g, ""));
    const range = NUMBER_RANGES[typedKey];
    if (!Number.isInteger(value)) return { ok: false, error: "یک عدد صحیح وارد کنید." };
    if (range && (value < range[0] || value > range[1])) {
      return { ok: false, error: `مقدار باید بین ${range[0]} تا ${range[1]} باشد.` };
    }
    return { ok: true, value };
  }

  const text = sanitizeText(
    input,
    typedKey === "welcome_text" || typedKey === "ai_persona" ? 4000 : 500,
  );
  if (
    text.length === 0 && !["group_url", "ads_default_target", "support_username"].includes(typedKey)
  ) {
    return { ok: false, error: "مقدار نمی‌تواند خالی باشد." };
  }

  switch (typedKey) {
    case "channel_target": {
      const target = parseChatTarget(text);
      if (!target) return { ok: false, error: "کانال معتبر نیست (@username یا -100...)." };
      return { ok: true, value: target };
    }
    case "channel_url":
    case "group_url": {
      if (text.length === 0) return { ok: true, value: "" };
      if (!isValidUrl(text)) return { ok: false, error: "لینک معتبر نیست." };
      return { ok: true, value: text };
    }
    case "ads_default_target": {
      if (text.length === 0) return { ok: true, value: "" };
      const target = parseChatTarget(text);
      if (!target) return { ok: false, error: "مقصد معتبر نیست." };
      return { ok: true, value: target };
    }
    case "support_username": {
      if (text.length === 0) return { ok: true, value: "" };
      if (!/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(text)) {
        return { ok: false, error: "قالب درست: @username" };
      }
      return { ok: true, value: text };
    }
    case "timezone": {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: text });
      } catch {
        return { ok: false, error: "منطقه زمانی معتبر نیست (مثال: Asia/Tehran)." };
      }
      return { ok: true, value: text };
    }
    case "ai_model": {
      if (!/^[a-z0-9.-]{2,60}$/i.test(text)) return { ok: false, error: "نام مدل معتبر نیست." };
      return { ok: true, value: text };
    }
    default:
      return { ok: true, value: text };
  }
}

async function renderGeneral(ctx: Ctx): Promise<void> {
  const all = await ctx.settings.all();
  const pick = (key: SettingKey) => all[key] ?? DEFAULT_SETTINGS[key];
  const short = (key: SettingKey) => escapeHtml(truncate(String(pick(key) ?? ""), 40) || "—");
  const maintenance = pick("maintenance_mode") === true;

  const rows: Button[][] = [
    [
      {
        text: `🛠 حالت تعمیر: ${maintenance ? "🟢 روشن" : "🔴 خاموش"}`,
        callback_data: "a:se:t:maintenance_mode",
      },
      { text: "🌐 منطقه زمانی", callback_data: "a:se:e:timezone" },
    ],
    [
      { text: "✉️ پیام تعمیر", callback_data: "a:se:e:maintenance_text" },
      { text: "💬 پیام خوش‌آمد", callback_data: "a:se:e:welcome_text" },
    ],
    [
      { text: "📢 کانال انتشار", callback_data: "a:se:e:channel_target" },
      { text: "🔗 لینک کانال", callback_data: "a:se:e:channel_url" },
    ],
    [
      { text: "👥 لینک گروه", callback_data: "a:se:e:group_url" },
      { text: "🆘 پشتیبانی", callback_data: "a:se:e:support_username" },
    ],
    [
      { text: "🏷 برچسب تبلیغ", callback_data: "a:se:e:ads_label" },
      { text: "🎯 مقصد تبلیغ", callback_data: "a:se:e:ads_default_target" },
    ],
    [
      { text: "🧩 ماژول‌ها", callback_data: "a:se:m" },
      { text: "⚡ کلمات آماده", callback_data: "a:se:pk" },
    ],
    [{ text: "🏠 داشبورد", callback_data: "a:h" }],
  ];

  await editOrSend(
    ctx,
    [
      sectionTitle("⚙️ تنظیمات ربات"),
      divider(),
      maintenance ? "🟠 ربات در حالت تعمیر است" : "🟢 ربات آنلاین و آمادهٔ کار است",
      "",
      `📢 کانال: <code>${short("channel_target")}</code>`,
      `👥 گروه: <code>${short("group_url")}</code>`,
      `🆘 پشتیبانی: <code>${short("support_username")}</code>`,
      `🌐 منطقه زمانی: <code>${short("timezone")}</code>`,
      `🏷 برچسب تبلیغ: <code>${short("ads_label")}</code>`,
      "",
      "<i>روی هر دکمه بزن تا مقدار تازه‌اش را بنویسی. آبی = تنظیم · سبز = خانه/روشن · قرمز = بازگشت/خاموش.</i>",
    ].join("\n"),
    keyboard(rows),
  );
}

async function renderModules(ctx: Ctx): Promise<void> {
  const all = await ctx.settings.all();
  const rows: Button[][] = [];
  for (const key of MODULE_KEYS) {
    const value = all[key] === true;
    rows.push([{
      text: `${labelFor(key)}: ${value ? "🟢 روشن" : "🔴 خاموش"}`,
      callback_data: `a:se:t:${key}`,
    }]);
  }
  rows.push([{ text: "🔢 محدودیت‌ها", callback_data: "a:se:l" }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle("🧩 ماژول‌ها و کلیدهای اصلی"),
      divider(),
      "با خاموش‌کردن هر ماژول، همان بخش از ربات برای کاربران غیرفعال می‌شود (داشبورد مدیران دست‌نخورده می‌ماند).",
    ].join("\n"),
    keyboard(rows),
  );
}

async function renderLimits(ctx: Ctx): Promise<void> {
  const all = await ctx.settings.all();
  const rows: Button[][] = LIMIT_KEYS.map((key) => [{
    text: `${labelFor(key)}: ${displayValue(all[key] ?? DEFAULT_SETTINGS[key])}`,
    callback_data: `a:se:e:${key}`,
  }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle("🔢 محدودیت‌ها و بازه‌ها"),
      divider(),
      LIMIT_KEYS.map((key) =>
        `• <b>${labelFor(key)}</b>: ${displayValue(all[key] ?? DEFAULT_SETTINGS[key])}`
      ).join("\n"),
    ].join("\n"),
    keyboard(rows),
  );
}

/** ⚡ کلمات آمادهٔ سفارشی — افزودن و حذف از داشبورد. */
async function renderPresets(ctx: Ctx): Promise<void> {
  const items = await loadCustomPresets(ctx.settings);
  const rows: Button[][] = items.map((item, index) => [{
    text: `🗑 حذف «${truncate(item.word, 22)}»`,
    callback_data: `a:se:pkx:${index}`,
    style: "danger" as const,
  }]);
  rows.push([{ text: "➕ افزودن کلمهٔ آماده", callback_data: "a:se:pka", style: "success" }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h", style: "success" }]);

  const customLines = items.length === 0
    ? "<i>هنوز کلمهٔ سفارشی نداری؛ با دکمهٔ پایین اضافه کن.</i>"
    : [
      `<b>کلمات سفارشی (${faNum(items.length)}):</b>`,
      ...items.map((item, index) =>
        `${faNum(index + 1)}. <code>${escapeHtml(item.word)}</code> ← ${
          escapeHtml(truncate(item.text, 40))
        }`
      ),
    ].join("\n");

  await editOrSend(
    ctx,
    [
      sectionTitle("⚡ کلمات آماده"),
      divider(),
      "این کلمه‌ها همان لحظه جواب می‌گیرند؛ نه فکر کردن، نه هوش مصنوعی.",
      "",
      "<b>کلمات داخلی:</b>",
      "بیو · ساعت · تاریخ · آیدی · راهنما · تاس · شیر یا خط · جمله · پیشنهاد انیمه",
      "سلام · معرفی · رمز · عدد شانسی",
      "",
      customLines,
      "",
      `<i>حداکثر ${faNum(MAX_CUSTOM_PRESETS)} کلمه؛ هر کلمه حداقل ۲ و حداکثر ۳۰ نویسه.</i>`,
    ].join("\n"),
    keyboard(rows),
  );
}

export async function renderAdmins(ctx: Ctx): Promise<void> {
  const admins = await selectRows<AdminRow>(ctx.sb, "admins", (q) => q.order("created_at"));
  const users = await selectRows<UserRow>(
    ctx.sb,
    "users",
    (q) => q.in("telegram_id", admins.map((admin) => admin.user_id)),
  );
  const userMap = new Map(users.map((user) => [user.telegram_id, user]));

  const rows: Button[][] = admins.map((admin) => {
    const role = ROLE_LABELS[admin.role];
    return [
      {
        text: `${role} • ${admin.user_id}`,
        callback_data: `a:se:ar:${admin.user_id}:${admin.role}`,
      },
      {
        text: admin.is_active ? "🚫 غیرفعال کن" : "✅ فعال کن",
        callback_data: `a:se:ax:${admin.user_id}`,
      },
    ];
  });
  rows.push([{ text: "➕ افزودن مدیر", callback_data: "a:se:adm" }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  const lines = admins.map((admin, index) => {
    const user = userMap.get(admin.user_id);
    const name = user
      ? (user.first_name ?? user.username ?? String(admin.user_id))
      : String(admin.user_id);
    return `${faNum(index + 1)}. <b>${escapeHtml(name)}</b> — ${ROLE_LABELS[admin.role]}${
      admin.is_active ? "" : " (غیرفعال)"
    }\n    <code>${admin.user_id}</code> • ${faDateTime(admin.created_at)}`;
  });

  await editOrSend(
    ctx,
    [
      sectionTitle("🎖 مدیران مجاز"),
      divider(),
      lines.join("\n") || "<i>مدیری ثبت نشده است.</i>",
      "",
      "<i>مالک اصلی از طریق SUPER_ADMIN_IDS تعیین می‌شود و قابل حذف نیست.</i>",
    ].join("\n"),
    keyboard(rows),
  );
}

export async function handleSettingsCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] !== "se") return false;
  const sub = parts[2];

  if (!sub || sub === "g") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    await renderGeneral(ctx);
    return true;
  }

  if (sub === "m") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    await renderModules(ctx);
    return true;
  }

  if (sub === "l") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    await renderLimits(ctx);
    return true;
  }

  if (sub === "pk") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    await renderPresets(ctx);
    return true;
  }

  if (sub === "pka") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    const items = await loadCustomPresets(ctx.settings);
    if (items.length >= MAX_CUSTOM_PRESETS) {
      await answerCallback(ctx, `سقف ${MAX_CUSTOM_PRESETS} کلمه پر شده است.`, true);
      return true;
    }
    await askForInput(
      ctx,
      "preset_add",
      [
        "➕ <b>کلمهٔ آمادهٔ جدید</b>",
        "کلمه و پاسخ را با علامت | جدا کن:",
        "<code>ساعت کاری | از شنبه تا چهارشنبه ۹ تا ۱۷</code>",
        "",
        "<i>کلمه حداقل ۲ و حداکثر ۳۰ نویسه است و به بزرگی/کوچکی حروف و نیم‌فاصله حساس نیست.</i>",
      ].join("\n"),
      {},
      "a:se:pk",
    );
    return true;
  }

  if (sub === "pkx") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    const index = Number(parts[3]);
    const items = await loadCustomPresets(ctx.settings);
    if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) {
      await answerCallback(ctx, "این کلمه پیدا نشد.", true);
      return true;
    }
    const removed = items.splice(index, 1)[0];
    await ctx.settings.set(PRESET_SETTINGS_KEY, items, ctx.userId);
    invalidatePresetCache();
    await logAdminAction(ctx, "preset_remove", "setting", PRESET_SETTINGS_KEY, {
      word: removed?.word,
    });
    await answerCallback(ctx, `«${removed?.word ?? ""}» حذف شد.`);
    await renderPresets(ctx);
    return true;
  }

  if (sub === "a") {
    if (!(await guardAdmin(ctx, "admins.manage"))) return true;
    await renderAdmins(ctx);
    return true;
  }

  if (sub === "adm") {
    if (!(await guardAdmin(ctx, "admins.manage"))) return true;
    await askForInput(
      ctx,
      "admin_admin_add",
      "🎖 <b>افزودن مدیر</b>\nشناسه‌ی عددی تلگرام کاربر را بفرستید (کاربر باید حداقل یک‌بار با ربات تعامل کرده باشد).",
      {},
      "a:se:a",
    );
    return true;
  }

  if (sub === "ar") {
    if (!(await guardAdmin(ctx, "admins.manage"))) return true;
    const userId = Number(parts[3]);
    const role = parts[4] as AdminRole;
    if (!Number.isSafeInteger(userId) || !(role in ROLE_LABELS)) {
      await answerCallback(ctx, "درخواست نامعتبر است.", true);
      return true;
    }
    const target = await selectOne<AdminRow>(ctx.sb, "admins", (q) => q.eq("user_id", userId));
    if (!target) {
      await answerCallback(ctx, "مدیر پیدا نشد.", true);
      return true;
    }
    if (!canManageRole(ctx.admin!, target.role) || role === "owner") {
      await answerCallback(ctx, "اجازه تغییر این نقش را ندارید.", true);
      return true;
    }
    await renderRolePicker(ctx, userId, target.role);
    return true;
  }

  if (sub === "ax") {
    if (!(await guardAdmin(ctx, "admins.manage"))) return true;
    const userId = Number(parts[3]);
    const target = await selectOne<AdminRow>(ctx.sb, "admins", (q) => q.eq("user_id", userId));
    if (!target) {
      await answerCallback(ctx, "مدیر پیدا نشد.", true);
      return true;
    }
    if (target.role === "owner") {
      await answerCallback(ctx, "مالک اصلی قابل حذف/تغییر نیست.", true);
      return true;
    }
    if (userId === ctx.userId) {
      await answerCallback(ctx, "نمی‌توانید دسترسی خودتان را حذف کنید.", true);
      return true;
    }
    await askConfirm(
      ctx,
      `🚫 ${target.is_active ? "غیرفعال‌سازی" : "فعال‌سازی"} مدیر <code>${userId}</code>؟`,
      target.is_active ? "admin_remove" : "admin_restore",
      { userId },
      "a:se:a",
    );
    return true;
  }

  if (sub === "t") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    const key = parts[3] ?? "";
    if (!(key in DEFAULT_SETTINGS) || typeof DEFAULT_SETTINGS[key as SettingKey] !== "boolean") {
      await answerCallback(ctx, "کلید نامعتبر است.", true);
      return true;
    }
    const current = await ctx.settings.get(key as SettingKey);
    await ctx.settings.set(key, !current, ctx.userId);
    await logAdminAction(ctx, "setting_toggle", "setting", key, { value: !current });
    await answerCallback(ctx, `${labelFor(key as SettingKey)}: ${!current ? "روشن" : "خاموش"}`);
    if (
      [
        "feature_ai",
        "feature_anime",
        "feature_news",
        "feature_ads",
        "feature_broadcast",
        "feature_content",
        "feature_groups",
        "feature_scheduling",
        "ai_enabled",
        "ai_memory_enabled",
        "ai_anime_context",
        "weekly_report_enabled",
        "daily_stats_enabled",
        "broadcast_require_confirm",
      ].includes(key)
    ) {
      await renderModules(ctx);
    } else {
      await renderGeneral(ctx);
    }
    return true;
  }

  if (sub === "e") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    const key = parts[3] ?? "";
    if (!(key in DEFAULT_SETTINGS)) {
      await answerCallback(ctx, "کلید نامعتبر است.", true);
      return true;
    }
    const current = await ctx.settings.get(key as SettingKey);
    await askForInput(
      ctx,
      "admin_setting",
      [
        `✏️ <b>${labelFor(key as SettingKey)}</b>`,
        `مقدار فعلی: ${displayValue(current)}`,
        key === "maintenance_text" || key === "welcome_text"
          ? "متن جدید را بفرستید (HTML ساده مجاز است)."
          : "مقدار جدید را بفرستید.",
      ].join("\n"),
      { key },
      "a:se",
    );
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

async function renderRolePicker(ctx: Ctx, userId: number, currentRole: AdminRole): Promise<void> {
  const roles: AdminRole[] = ["moderator", "admin", "super_admin"];
  const rows: Button[][] = roles.map((role) => [{
    text: `${role === currentRole ? "• " : ""}${ROLE_LABELS[role]}`,
    callback_data: `a:se:rc:${userId}:${role}`,
  }]);
  rows.push([{ text: "◀️ بازگشت", callback_data: "a:se:a" }]);

  await editOrSend(
    ctx,
    [
      `<b>🎖 تغییر نقش مدیر</b> <code>${userId}</code>`,
      `نقش فعلی: ${ROLE_LABELS[currentRole]}`,
      "",
      "<i>مدیر ارشد همه‌ی دسترسی‌ها به‌جز مدیریت مدیران را دارد. نقش «مالک» فقط از SUPER_ADMIN_IDS تعیین می‌شود.</i>",
    ].join("\n"),
    keyboard(rows),
  );
}

export async function handleSettingsCallbackExtra(ctx: Ctx, parts: string[]): Promise<boolean> {
  // a:se:rc:<id>:<role> — انتخاب نقش نهایی
  if (parts[1] !== "se" || parts[2] !== "rc") return false;
  if (!(await guardAdmin(ctx, "admins.manage"))) return true;

  const userId = Number(parts[3]);
  const role = parts[4] as AdminRole;
  if (!Number.isSafeInteger(userId) || !(role in ROLE_LABELS) || role === "owner") {
    await answerCallback(ctx, "درخواست نامعتبر است.", true);
    return true;
  }

  const target = await selectOne<AdminRow>(ctx.sb, "admins", (q) => q.eq("user_id", userId));
  if (!target) {
    await answerCallback(ctx, "مدیر پیدا نشد.", true);
    return true;
  }
  if (!canManageRole(ctx.admin!, target.role) || !canManageRole(ctx.admin!, role)) {
    await answerCallback(ctx, "اجازه این تغییر را ندارید.", true);
    return true;
  }

  await askConfirm(
    ctx,
    `🎖 تغییر نقش <code>${userId}</code> از «${ROLE_LABELS[target.role]}» به «${
      ROLE_LABELS[role]
    }»؟`,
    "admin_role_change",
    { userId, role },
    "a:se:a",
  );
  return true;
}

export async function handleSettingsInput(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  if (action === "admin_setting") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    const key = String(args.key ?? "");
    const parsed = parseSettingValue(key, text);
    if (!parsed.ok) {
      await send(ctx, `⚠️ ${parsed.error}`);
      return true;
    }
    await ctx.settings.set(key, parsed.value, ctx.userId);
    await logAdminAction(ctx, "setting_update", "setting", key, { value: parsed.value });
    await send(ctx, `✅ «${labelFor(key as SettingKey)}» به‌روزرسانی شد.`);
    if (AI_PANEL_KEYS.includes(key)) {
      // برگشت به همان پنلی که ویرایش از آن شروع شده بود.
      const { renderAiPanel } = await import("./ai.ts");
      await renderAiPanel(ctx);
    } else if (LIMIT_KEYS.includes(key as SettingKey)) {
      await renderLimits(ctx);
    } else {
      await renderGeneral(ctx);
    }
    return true;
  }

  if (action === "preset_add") {
    if (!(await guardAdmin(ctx, "settings.manage"))) return true;
    const raw = text.trim();
    const separator = raw.search(/[|=\uFF5C]/);
    if (separator <= 0) {
      await send(ctx, "⚠️ قالب درست: کلمه | پاسخ");
      return true;
    }
    const word = sanitizePresetWord(raw.slice(0, separator));
    const replyText = raw.slice(separator + 1).trim().slice(0, MAX_PRESET_REPLY);
    if (word.length < 2) {
      await send(ctx, "⚠️ کلمه باید حداقل ۲ نویسه باشد.");
      return true;
    }
    if (replyText.length === 0) {
      await send(ctx, "⚠️ پاسخ کلمه نمی‌تواند خالی باشد.");
      return true;
    }
    const items = await loadCustomPresets(ctx.settings);
    const existing = items.findIndex((item) => item.word === word);
    if (existing >= 0) {
      items[existing] = { word, text: replyText };
    } else {
      if (items.length >= MAX_CUSTOM_PRESETS) {
        await send(ctx, `⚠️ حداکثر ${MAX_CUSTOM_PRESETS} کلمه می‌توانی داشته باشی.`);
        return true;
      }
      items.push({ word, text: replyText });
    }
    await ctx.settings.set(PRESET_SETTINGS_KEY, items, ctx.userId);
    invalidatePresetCache();
    await logAdminAction(ctx, "preset_save", "setting", PRESET_SETTINGS_KEY, { word });
    await send(ctx, `✅ «${word}» آماده شد.`);
    await renderPresets(ctx);
    return true;
  }

  if (action === "admin_admin_add") {
    if (!(await guardAdmin(ctx, "admins.manage"))) return true;
    const userId = parseTelegramId(text);
    if (!userId) {
      await send(ctx, "⚠️ شناسه‌ی عددی معتبر نیست.");
      return true;
    }
    const existing = await selectOne<AdminRow>(ctx.sb, "admins", (q) => q.eq("user_id", userId));
    if (existing) {
      await send(ctx, "این کاربر از قبل مدیر است.");
      return true;
    }
    let user = await selectOne<UserRow>(ctx.sb, "users", (q) => q.eq("telegram_id", userId));
    if (!user) {
      try {
        user = await insertRow<UserRow>(ctx.sb, "users", {
          telegram_id: userId,
          first_name: "مدیر جدید",
        });
      } catch {
        await send(ctx, "⚠️ ساخت رکورد کاربر ناموفق بود. کاربر ابتدا باید /start بزند.");
        return true;
      }
    }
    await insertRow(ctx.sb, "admins", {
      user_id: userId,
      role: "admin",
      permissions: [],
      is_active: true,
      added_by: ctx.userId,
    });
    await logAdminAction(ctx, "admin_add", "admin", userId, { role: "admin" });
    await send(ctx, `✅ کاربر <code>${userId}</code> با نقش «مدیر» اضافه شد.`);
    await renderAdmins(ctx);
    return true;
  }

  return false;
}

export async function runSettingsConfirm(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (action !== "admin_role_change" && action !== "admin_remove" && action !== "admin_restore") {
    return false;
  }
  if (!(await guardAdmin(ctx, "admins.manage"))) return true;

  const userId = Number(args.userId);
  const target = await selectOne<AdminRow>(ctx.sb, "admins", (q) => q.eq("user_id", userId));
  if (!target) {
    await send(ctx, "مدیر پیدا نشد.");
    return true;
  }
  if (target.role === "owner") {
    await send(ctx, "⛔ مالک اصلی قابل تغییر یا حذف نیست.");
    return true;
  }

  if (action === "admin_role_change") {
    const role = String(args.role) as AdminRole;
    if (!(role in ROLE_LABELS) || role === "owner") {
      await send(ctx, "نقش نامعتبر است.");
      return true;
    }
    if (!canManageRole(ctx.admin!, role)) {
      await send(ctx, "اجازه تعیین این نقش را ندارید.");
      return true;
    }
    await updateRows(ctx.sb, "admins", {
      role,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { user_id: userId });
    await logAdminAction(ctx, "admin_role_change", "admin", userId, { role });
    await send(ctx, `✅ نقش کاربر <code>${userId}</code> به «${ROLE_LABELS[role]}» تغییر کرد.`);
    await renderAdmins(ctx);
    return true;
  }

  if (action === "admin_remove" || action === "admin_restore") {
    if (userId === ctx.userId) {
      await send(ctx, "⛔ نمی‌توانید وضعیت دسترسی خودتان را تغییر دهید.");
      return true;
    }
    const isActive = action === "admin_restore";
    await updateRows(ctx.sb, "admins", {
      is_active: isActive,
      updated_at: new Date().toISOString(),
    }, { user_id: userId });
    await logAdminAction(ctx, isActive ? "admin_restore" : "admin_remove", "admin", userId);
    await send(ctx, isActive ? "✅ مدیر فعال شد." : "🚫 مدیر غیرفعال شد.");
    await renderAdmins(ctx);
    return true;
  }

  return true;
}

export const SETTINGS_PERMISSION: Permission = "settings.manage";
