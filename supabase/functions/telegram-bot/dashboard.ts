/** داشبورد اصلی مدیریت و صفحه‌ی کاربر. */
import { countRows, selectOne } from "../_shared/db.ts";
import { getAiState } from "../_shared/ai_core.ts";
import {
  ADMIN_MENU_SECTIONS,
  adminMainKeyboard,
  keyboard,
  urlButton,
  userMainKeyboard,
} from "../_shared/keyboards.ts";
import { ROLE_LABELS } from "../_shared/auth.ts";
import {
  displayName,
  divider,
  faDateTime,
  faNum,
  sectionTitle,
  statusLabel,
} from "../_shared/texts.ts";
import { startOfDayIso } from "../_shared/rate_limit.ts";
import { answerCallback, type Ctx, editOrSend, isPrivate, send } from "./context.ts";
import type { AiStateRow, UserRow } from "../_shared/types.ts";

async function enabledFeatures(ctx: Ctx): Promise<Record<string, boolean>> {
  const all = await ctx.settings.all();
  return {
    ai: all.feature_ai !== false,
    anime: all.feature_anime !== false,
    news: all.feature_news !== false,
    ads: all.feature_ads !== false,
    broadcast: all.feature_broadcast !== false,
    content: all.feature_content !== false,
    groups: all.feature_groups !== false,
    scheduling: all.feature_scheduling !== false,
  };
}

export async function renderAdminHome(ctx: Ctx, asEdit = true): Promise<void> {
  if (!isPrivate(ctx)) {
    await send(ctx, "🔐 داشبورد فقط در چت خصوصی در دسترس است.", {
      inline_keyboard: [[{
        text: "🤖 ورود",
        url: `https://t.me/${ctx.cfg.botUsername}?start=admin`,
      }]],
    });
    return;
  }

  const timeZone = await ctx.settings.get("timezone");
  const todayStart = startOfDayIso(timeZone, ctx.now);
  const [totalUsers, newUsers, blocked, groups, aiState, version, maintenance, features] =
    await Promise.all([
      countRows(ctx.sb, "users"),
      countRows(ctx.sb, "users", (q) => q.gte("created_at", todayStart)),
      countRows(ctx.sb, "banned_users", (q) => q.eq("is_active", true)),
      countRows(ctx.sb, "groups", (q) => q.eq("is_active", true)),
      getAiState(ctx.sb),
      ctx.settings.get("bot_version"),
      ctx.settings.get("maintenance_mode"),
      enabledFeatures(ctx),
    ]);

  const aiLabel = statusLabel("ai", aiState.status);
  const role = ctx.admin ? ROLE_LABELS[ctx.admin.role] : "—";
  const name = displayName(ctx.user);

  const text = [
    "<b>🎛 داشبورد مدیریت Anime Click Ultimate</b>",
    `<i>${faDateTime(ctx.now, timeZone)}</i>`,
    divider(),
    `👤 ${name} • نقش: <b>${role}</b>`,
    `👥 کاربران: <b>${faNum(totalUsers)}</b> (امروز +${faNum(newUsers)})`,
    `🚫 مسدود: ${faNum(blocked)} • 👮 گروه‌ها: ${faNum(groups)}`,
    `🤖 هوش مصنوعی: ${aiLabel}`,
    `${maintenance ? "🛠 حالت تعمیر: <b>روشن</b>" : "✅ حالت تعمیر: خاموش"} • نسخه ${version}`,
    divider(),
    "<i>یک بخش را انتخاب کنید. همه‌ی تغییرات حساس تأیید می‌خواهند.</i>",
  ].join("\n");

  const markup = adminMainKeyboard(ctx.admin, features);
  if (asEdit) await editOrSend(ctx, text, markup);
  else await send(ctx, text, markup);
}

export async function renderAdminProfile(ctx: Ctx): Promise<void> {
  if (!ctx.admin) return;
  const timeZone = await ctx.settings.get("timezone");
  const roleLabel = ROLE_LABELS[ctx.admin.role];
  const permissions = ctx.admin.permissions;

  const text = [
    "<b>👤 پروفایل مدیر</b>",
    divider(),
    `شناسه: <code>${ctx.userId}</code>`,
    `نام: ${displayName(ctx.user)}`,
    `نقش: <b>${roleLabel}</b>`,
    `عضویت مدیر: ${faDateTime(ctx.user.created_at, timeZone)}`,
    "",
    sectionTitle("دسترسی‌ها"),
    permissions.length > 0
      ? permissions.map((permission) => `• <code>${permission}</code>`).join("\n")
      : "—",
    "",
    "<i>برای تغییر نقش‌ها از ⚙️ تنظیمات ربات → مدیران استفاده کنید.</i>",
  ].join("\n");

  await editOrSend(
    ctx,
    text,
    keyboard([
      [{ text: "🏠 داشبورد", callback_data: "a:h" }],
    ]),
  );
}

export function buildUserMenuMarkup(
  channelUrl: string,
  groupUrl: string,
  features: Record<string, boolean>,
): ReturnType<typeof keyboard> {
  // یک منبع واحد برای منوی کاربر (دسته‌بندی‌شده در shared/keyboards.ts)
  return userMainKeyboard({
    channelUrl,
    supportUrl: groupUrl,
    showAi: features.ai === true,
    showAnime: features.anime === true,
    showNews: features.news === true,
  });
}

export async function renderUserHome(ctx: Ctx, customTitle?: string): Promise<void> {
  const welcomeRaw = await ctx.settings.get("welcome_text");
  const welcome = welcomeRaw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const channelUrl = await ctx.settings.get("channel_url");
  const groupUrl = await ctx.settings.get("group_url");
  const features = await enabledFeatures(ctx);
  const name = displayName(ctx.user);

  const text = [
    customTitle ? `<b>${customTitle}</b>` : "",
    customTitle ? "" : `سلام <b>${name}</b> 👋`,
    ctx.admin ? `👑 نقش شما در ربات: <b>${ROLE_LABELS[ctx.admin.role]}</b>` : "",
    welcome,
    "",
    "<i>با دکمه‌های زیر شروع کنید یا همین‌جا سوال خود را بنویسید.</i>",
  ].filter(Boolean).join("\n");

  const markup = buildUserMenuMarkup(channelUrl, groupUrl, features);
  if (ctx.admin) {
    markup.inline_keyboard.unshift([
      { text: "🎛 داشبورد مدیریت", callback_data: "a:h" },
    ]);
  }

  await send(ctx, text, markup);
}

export async function renderUserHelp(ctx: Ctx): Promise<void> {
  const features = await enabledFeatures(ctx);
  const lines = [
    "<b>ℹ️ راهنمای Anime Click Ultimate</b>",
    divider(),
    "• <b>چت هوشمند</b>: دکمه 🤖 یا <code>/ai سوال</code>",
    "• <b>جستجوی انیمه</b>: دکمه 🔎 یا <code>/anime نام</code>",
    "• <b>اخبار</b>: <code>/news</code>",
    "• <b>پروفایل</b>: <code>/profile</code>",
    "• <b>حریم خصوصی</b>: <code>/privacy</code>",
    "• <b>توقف پیام‌ها</b>: <code>/stop</code>",
    "• <b>حذف داده‌ها</b>: <code>/deletedata</code>",
    "• <b>صاحب ربات</b>: <code>/owner</code>",
    ctx.admin?.role === "owner"
      ? "• <b>متن اخطار گروه‌ها</b>: <code>/warning</code> یا بنویسید <code>اخطار متن…</code>"
      : "",
    "",
    features.anime
      ? "<i>اطلاعات انیمه از منابع معتبر انیمه گرفته می‌شود و ممکن است چند ساعت تأخیر داشته باشد.</i>"
      : "",
    "<i>برای انصراف از حالت چت، /cancel را بفرستید.</i>",
  ].filter(Boolean);

  await editOrSend(
    ctx,
    lines.join("\n"),
    keyboard([
      [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
    ]),
  );
}

/** 👑 پنل صاحب ربات — تشخیص مالک و میان‌برهای اختصاصی. */
export async function renderOwnerPanel(ctx: Ctx): Promise<void> {
  if (!isPrivate(ctx)) {
    await send(ctx, "👑 پنل صاحب ربات فقط در چت خصوصی باز می‌شود.", {
      inline_keyboard: [[{
        text: "🤖 ورود به ربات",
        url: `https://t.me/${ctx.cfg.botUsername}?start=owner`,
      }]],
    });
    return;
  }

  const support = await ctx.settings.get("support_username");

  if (ctx.admin?.role !== "owner") {
    await send(
      ctx,
      [
        sectionTitle("👑 صاحب ربات"),
        divider(),
        "این ربات صاحب مشخصی دارد و توسط تیم پشتیبانی اداره می‌شود.",
        support ? `📮 پشتیبانی: ${support}` : "",
        "",
        "<i>دستورات مدیریتی فقط برای صاحب ربات فعال است.</i>",
      ].filter(Boolean).join("\n"),
      keyboard([
        [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
      ]),
    );
    return;
  }

  const ownerId = ctx.cfg.superAdminIds[0];
  const [ownerRow, users] = await Promise.all([
    selectOne<Pick<UserRow, "first_name" | "last_name" | "username">>(
      ctx.sb,
      "users",
      (q) => q.eq("telegram_id", ownerId),
    ),
    countRows(ctx.sb, "users"),
  ]);

  const ownerName = ownerRow ? displayName(ownerRow) : displayName(ctx.user);
  const timeZone = await ctx.settings.get("timezone");

  await send(
    ctx,
    [
      sectionTitle("👑 پنل صاحب ربات"),
      divider(),
      `سلام <b>${ownerName}</b> — شما صاحب این ربات هستید.`,
      `شناسه مالک: <code>${ownerId}</code> • کاربران ربات: ${faNum(users)}`,
      `زمان: ${faDateTime(ctx.now, timeZone)}`,
      "",
      "<b>دستورات اختصاصی شما</b>",
      "• <code>اخطار متن دلخواه…</code> — ثبت متن اخطار گروه‌ها",
      "• <code>/warning</code> — مشاهده و تغییر متن اخطار",
      "• <code>/admin</code> — داشبورد کامل مدیریت",
      "",
      "<i>ربات شما را می‌شناسد: در گروه‌ها اخطارها و گزارش‌ها با نام شما ثبت می‌شود.</i>",
    ].join("\n"),
    keyboard([
      [{ text: "🎛 داشبورد مدیریت", callback_data: "a:h" }],
      [{ text: "⚠️ متن اخطار", callback_data: "u:wn" }, {
        text: "🏠 منوی اصلی",
        callback_data: "u:m",
      }],
    ]),
  );
}

export async function handleDashboardCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  const section = parts[1];

  if (section === "h" || section === undefined) {
    const maintenance = await ctx.settings.get("maintenance_mode");
    if (maintenance && ctx.admin?.role !== "owner") {
      await answerCallback(ctx, "حالت تعمیر فعال است.", true);
      return true;
    }
    await renderAdminHome(ctx);
    return true;
  }

  if (section === "me") {
    await renderAdminProfile(ctx);
    return true;
  }

  return false;
}

export async function handleUserCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  const action = parts[1];
  switch (action) {
    case "m":
      await renderUserHome(ctx);
      return true;
    case "hl":
      await renderUserHelp(ctx);
      return true;
    default:
      return false;
  }
}

/** تعداد کاربران فعال امروز — برای کارت آماری کوچک در صفحه‌ی اصلی. */
export async function quickCounts(ctx: Ctx): Promise<{ total: number; newToday: number }> {
  const timeZone = await ctx.settings.get("timezone");
  const todayStart = startOfDayIso(timeZone, ctx.now);
  const [total, newToday] = await Promise.all([
    countRows(ctx.sb, "users"),
    countRows(ctx.sb, "users", (q) => q.gte("created_at", todayStart)),
  ]);
  return { total, newToday };
}

export async function aiStateOrNull(ctx: Ctx): Promise<AiStateRow | null> {
  return await selectOne<AiStateRow>(ctx.sb, "ai_state", (q) => q.eq("id", 1));
}
