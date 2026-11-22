/** 👮 مدیریت گروه — ثبت گروه‌ها، تنظیمات مستقل، ضداسپم و لاگ اقدامات. */
import { countRows, insertRow, selectOne, selectRows, updateRows } from "../_shared/db.ts";
import { type Button, keyboard } from "../_shared/keyboards.ts";
import { divider, faDateTime, faNum, sectionTitle } from "../_shared/texts.ts";
import { escapeHtml, truncate } from "../_shared/validation.ts";
import type { TgChat } from "../_shared/types.ts";
import type { GroupRow, GroupSettingsRow, ModerationLogRow } from "../_shared/types.ts";
import {
  answerCallback,
  askForInput,
  type Ctx,
  editOrSend,
  guardAdmin,
  logAdminAction,
  send,
} from "./context.ts";

const TOGGLE_FIELDS: Record<string, { label: string; emoji: string }> = {
  welcome_enabled: { label: "خوش‌آمدگویی", emoji: "👋" },
  goodbye_enabled: { label: "خداحافظی", emoji: "🚪" },
  antilink_enabled: { label: "ضدلینک", emoji: "🔗" },
  antispam_enabled: { label: "ضداسپم", emoji: "🛡" },
  block_forwards: { label: "جلوگیری از فوروارد", emoji: "📤" },
  delete_warn_messages: { label: "حذف پیام متخلف", emoji: "🧹" },
};

const TEXT_FIELDS: Record<string, string> = {
  welcome_text: "متن خوش‌آمدگویی",
  goodbye_text: "متن خداحافظی",
  rules_text: "قوانین گروه",
};

const INT_FIELDS: Record<string, { label: string; min: number; max: number }> = {
  flood_limit: { label: "حد پیام در بازه (flood)", min: 2, max: 60 },
  flood_window_seconds: { label: "بازه‌ی شمارش اسپم (ثانیه)", min: 5, max: 600 },
  warn_limit: { label: "تعداد اخطار قبل از اقدام", min: 1, max: 10 },
  mute_duration_minutes: { label: "مدت سکوت (دقیقه)", min: 1, max: 525600 },
};

const trackedChats = new Set<number>();
let cachedBotId: number | null = null;

async function getBotId(ctx: Ctx): Promise<number | null> {
  if (cachedBotId) return cachedBotId;
  try {
    const me = await ctx.tg.getMe();
    cachedBotId = me.id;
    return me.id;
  } catch {
    return null;
  }
}

export async function ensureGroupRecord(ctx: Ctx, chat: TgChat): Promise<GroupRow | null> {
  if (!["group", "supergroup", "channel"].includes(chat.type)) return null;

  const existing = await selectOne<GroupRow>(
    ctx.sb,
    "groups",
    (q) => q.eq("telegram_chat_id", chat.id),
  );

  const botId = await getBotId(ctx);
  let botIsAdmin = existing?.bot_is_admin ?? false;
  if (botId) {
    try {
      const member = await ctx.tg.getChatMember(chat.id, botId);
      botIsAdmin = member.status === "administrator" || member.status === "creator";
    } catch {
      // اگر نتوانستیم بررسی کنیم، مقدار قبلی حفظ می‌شود
    }
  }

  const values = {
    telegram_chat_id: chat.id,
    title: chat.title ?? existing?.title ?? null,
    username: chat.username ?? existing?.username ?? null,
    type: chat.type,
    is_active: true,
    bot_is_admin: botIsAdmin,
    updated_at: new Date().toISOString(),
    left_at: null,
  };

  let row: GroupRow | null = null;
  if (existing) {
    const updated = await updateRows<GroupRow>(ctx.sb, "groups", values, {
      telegram_chat_id: chat.id,
    });
    row = updated[0] ?? existing;
  } else {
    row = await insertRow<GroupRow>(ctx.sb, "groups", values);
    trackedChats.add(chat.id);
  }

  if (!trackedChats.has(chat.id)) {
    const settings = await selectOne<GroupSettingsRow>(
      ctx.sb,
      "group_settings",
      (q) => q.eq("group_id", chat.id),
    );
    if (!settings) {
      try {
        await insertRow(ctx.sb, "group_settings", { group_id: chat.id });
      } catch {
        // اگر هم‌زمان ساخته شد
      }
    }
    trackedChats.add(chat.id);
  }

  return row;
}

export async function getGroupSettings(
  ctx: Ctx,
  groupId: number,
): Promise<GroupSettingsRow> {
  const settings = await selectOne<GroupSettingsRow>(
    ctx.sb,
    "group_settings",
    (q) => q.eq("group_id", groupId),
  );
  if (settings) return settings;
  try {
    return await insertRow<GroupSettingsRow>(ctx.sb, "group_settings", { group_id: groupId });
  } catch {
    const fallback = await selectOne<GroupSettingsRow>(
      ctx.sb,
      "group_settings",
      (q) => q.eq("group_id", groupId),
    );
    if (fallback) return fallback;
    throw new Error("group_settings unavailable");
  }
}

export async function markGroupInactive(ctx: Ctx, chatId: number): Promise<void> {
  await updateRows(ctx.sb, "groups", {
    is_active: false,
    left_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { telegram_chat_id: chatId });
}

function groupView(group: GroupRow, settings: GroupSettingsRow): string {
  const toggles = Object.entries(TOGGLE_FIELDS).map(([field, meta]) => {
    const value = settings[field as keyof GroupSettingsRow] as boolean;
    return `${meta.emoji} ${meta.label}: ${value ? "🟢" : "🔴"}`;
  });

  return [
    `<b>👮 ${escapeHtml(group.title ?? String(group.telegram_chat_id))}</b>`,
    divider(),
    `شناسه: <code>${group.telegram_chat_id}</code>`,
    `نوع: ${group.type} • وضعیت: ${group.is_active ? "فعال" : "غیرفعال"}`,
    `دسترسی مدیریت ربات: ${group.bot_is_admin ? "✅ دارد" : "❌ ندارد"}`,
    group.member_count ? `اعضا: ${faNum(group.member_count)}` : "",
    "",
    "<b>تغییرات سریع</b>",
    toggles.join("\n"),
    "",
    `⚠️ حد اخطار: ${faNum(settings.warn_limit)} → اقدام: ${settings.warn_action}`,
    `🌊 اسپم: ${faNum(settings.flood_limit)} پیام در ${faNum(settings.flood_window_seconds)} ثانیه`,
    `🔇 مدت سکوت: ${faNum(settings.mute_duration_minutes)} دقیقه`,
    "",
    `📜 قوانین: ${escapeHtml(truncate(settings.rules_text, 200))}`,
    `👋 خوش‌آمد: ${escapeHtml(truncate(settings.welcome_text, 120))}`,
    `🚪 خداحافظی: ${escapeHtml(truncate(settings.goodbye_text, 120))}`,
  ].filter(Boolean).join("\n");
}

function groupKeyboard(group: GroupRow, settings: GroupSettingsRow): ReturnType<typeof keyboard> {
  const id = group.telegram_chat_id;
  const rows: Button[][] = [];

  const toggleEntries = Object.entries(TOGGLE_FIELDS);
  for (let i = 0; i < toggleEntries.length; i += 2) {
    rows.push(
      toggleEntries.slice(i, i + 2).map(([field, meta]) => ({
        text: `${meta.emoji} ${meta.label}: ${
          settings[field as keyof GroupSettingsRow] ? "🟢" : "🔴"
        }`,
        callback_data: `a:g:${id}:t:${field}`,
      })),
    );
  }

  rows.push([
    { text: "👋 متن خوش‌آمد", callback_data: `a:g:${id}:e:welcome_text` },
    { text: "🚪 متن خداحافظی", callback_data: `a:g:${id}:e:goodbye_text` },
  ]);
  rows.push([
    { text: "📜 قوانین", callback_data: `a:g:${id}:e:rules_text` },
    { text: "⚙️ حد اخطار", callback_data: `a:g:${id}:i:warn_limit` },
  ]);
  rows.push([
    { text: "🌊 حد اسپم", callback_data: `a:g:${id}:i:flood_limit` },
    { text: "⏱ بازه اسپم", callback_data: `a:g:${id}:i:flood_window_seconds` },
  ]);
  rows.push([
    { text: "🔇 مدت سکوت", callback_data: `a:g:${id}:i:mute_duration_minutes` },
    { text: `⚖️ اقدام: ${settings.warn_action}`, callback_data: `a:g:${id}:wa` },
  ]);
  rows.push([
    { text: "📋 لاگ اقدامات", callback_data: `a:g:${id}:l` },
    { text: "🔄 به‌روزرسانی", callback_data: `a:g:${id}` },
  ]);
  rows.push([
    { text: "👮 همه گروه‌ها", callback_data: "a:gr" },
    { text: "🏠 داشبورد", callback_data: "a:h" },
  ]);
  return keyboard(rows);
}

async function renderGroup(ctx: Ctx, id: number): Promise<void> {
  const group = await selectOne<GroupRow>(ctx.sb, "groups", (q) => q.eq("telegram_chat_id", id));
  if (!group) {
    await editOrSend(
      ctx,
      "گروه پیدا نشد. اگر ربات تازه اضافه شده، یک پیام در گروه بفرستید.",
      keyboard([
        [{ text: "👮 گروه‌ها", callback_data: "a:gr" }],
      ]),
    );
    return;
  }
  const settings = await getGroupSettings(ctx, id);
  await editOrSend(ctx, groupView(group, settings), groupKeyboard(group, settings));
}

async function renderGroups(ctx: Ctx): Promise<void> {
  const groups = await selectRows<GroupRow>(
    ctx.sb,
    "groups",
    (q) => q.order("joined_at", { ascending: false }).limit(10),
  );
  const active = groups.filter((group) => group.is_active).length;

  const rows: Button[][] = groups.map((group) => [{
    text: `${group.is_active ? "🟢" : "🔴"} ${
      truncate(group.title ?? String(group.telegram_chat_id), 40)
    }`,
    callback_data: `a:g:${group.telegram_chat_id}`,
  }]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle("👮 مدیریت گروه‌ها"),
      divider(),
      groups.length === 0
        ? "<i>ربات هنوز به گروهی اضافه نشده است.</i>"
        : groups.map((group, index) =>
          `${faNum(index + 1)}. ${group.is_active ? "🟢" : "🔴"} <b>${
            escapeHtml(group.title ?? "—")
          }</b>\n    <code>${group.telegram_chat_id}</code> • ${group.type}${
            group.bot_is_admin ? " • ادمین ✅" : " • ادمین ❌"
          }`
        ).join("\n"),
      "",
      `<i>فعال: ${faNum(active)} از ${faNum(groups.length)} — تنظیمات هر گروه مستقل است.</i>`,
    ].join("\n"),
    keyboard(rows),
  );
}

async function renderGroupLogs(ctx: Ctx, id: number): Promise<void> {
  const logs = await selectRows<ModerationLogRow>(
    ctx.sb,
    "moderation_logs",
    (q) => q.eq("group_id", id).order("created_at", { ascending: false }).limit(12),
  );
  const lines = logs.length === 0
    ? ["<i>اقدامی ثبت نشده است.</i>"]
    : logs.map((log) =>
      `• ${log.action} — کاربر <code>${
        log.target_user_id ?? "—"
      }</code> توسط <code>${log.actor_id}</code>\n    ${faDateTime(log.created_at)}${
        log.reason ? ` • ${escapeHtml(truncate(log.reason, 60))}` : ""
      }`
    );

  const warnings = await countRows(
    ctx.sb,
    "user_warnings",
    (q) => q.eq("group_id", id).eq("is_active", true),
  );

  await editOrSend(
    ctx,
    [
      `<b>📋 لاگ اقدامات گروه</b> <code>${id}</code>`,
      divider(),
      `اخطارهای فعال: ${faNum(warnings)}`,
      ...lines,
    ].join("\n"),
    keyboard([
      [
        { text: "🔄 به‌روزرسانی", callback_data: `a:g:${id}:l` },
        { text: "⚙️ تنظیمات", callback_data: `a:g:${id}` },
      ],
      [{ text: "🏠 داشبورد", callback_data: "a:h" }],
    ]),
  );
}

export async function handleGroupsCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[1] === "gr") {
    if (!(await guardAdmin(ctx, "groups.read"))) return true;
    await renderGroups(ctx);
    return true;
  }

  if (parts[1] !== "g") return false;
  const id = Number(parts[2]);
  if (!Number.isSafeInteger(id)) {
    await answerCallback(ctx, "شناسه گروه نامعتبر است.", true);
    return true;
  }

  const sub = parts[3];

  if (!sub) {
    if (!(await guardAdmin(ctx, "groups.read"))) return true;
    await renderGroup(ctx, id);
    return true;
  }

  if (sub === "l") {
    if (!(await guardAdmin(ctx, "groups.read"))) return true;
    await renderGroupLogs(ctx, id);
    return true;
  }

  if (sub === "t") {
    if (!(await guardAdmin(ctx, "groups.manage"))) return true;
    const field = parts[4] ?? "";
    if (!(field in TOGGLE_FIELDS)) {
      await answerCallback(ctx, "تنظیم ناشناخته است.", true);
      return true;
    }
    const settings = await getGroupSettings(ctx, id);
    const current = settings[field as keyof GroupSettingsRow] as boolean;
    await updateRows(ctx.sb, "group_settings", {
      [field]: !current,
      updated_at: new Date().toISOString(),
    }, { group_id: id });
    await logAdminAction(ctx, "group_setting_toggle", "group", id, { field, value: !current });
    await renderGroup(ctx, id);
    await answerCallback(ctx, `${TOGGLE_FIELDS[field].label}: ${!current ? "روشن" : "خاموش"}`);
    return true;
  }

  if (sub === "e") {
    if (!(await guardAdmin(ctx, "groups.manage"))) return true;
    const field = parts[4] ?? "";
    if (!(field in TEXT_FIELDS)) {
      await answerCallback(ctx, "فیلد ناشناخته است.", true);
      return true;
    }
    await askForInput(
      ctx,
      "admin_group_text",
      `✏️ <b>${
        TEXT_FIELDS[field]
      }</b>\nمتن جدید را بفرستید.\nمتغیرهای مجاز: <code>{name}</code> <code>{group}</code> <code>{username}</code>`,
      { groupId: id, field },
      `a:g:${id}`,
    );
    return true;
  }

  if (sub === "i") {
    if (!(await guardAdmin(ctx, "groups.manage"))) return true;
    const field = parts[4] ?? "";
    const meta = INT_FIELDS[field];
    if (!meta) {
      await answerCallback(ctx, "فیلد نامعتبر است.", true);
      return true;
    }
    await askForInput(
      ctx,
      "admin_group_int",
      `🔢 <b>${meta.label}</b>\nیک عدد بین ${faNum(meta.min)} تا ${faNum(meta.max)} بفرستید.`,
      { groupId: id, field },
      `a:g:${id}`,
    );
    return true;
  }

  if (sub === "wa") {
    if (!(await guardAdmin(ctx, "groups.manage"))) return true;
    const settings = await getGroupSettings(ctx, id);
    const order: GroupSettingsRow["warn_action"][] = ["mute", "kick", "ban"];
    const next = order[(order.indexOf(settings.warn_action) + 1) % order.length];
    await updateRows(ctx.sb, "group_settings", {
      warn_action: next,
      updated_at: new Date().toISOString(),
    }, { group_id: id });
    await logAdminAction(ctx, "group_warn_action", "group", id, { value: next });
    await renderGroup(ctx, id);
    await answerCallback(ctx, `اقدام اخطار: ${next}`);
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

export async function handleGroupsInput(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  if (action !== "admin_group_text" && action !== "admin_group_int") return false;
  if (!(await guardAdmin(ctx, "groups.manage"))) return true;

  const groupId = Number(args.groupId);
  const field = String(args.field ?? "");
  if (!Number.isSafeInteger(groupId)) {
    await send(ctx, "شناسه گروه نامعتبر است.");
    return true;
  }

  if (action === "admin_group_text") {
    if (!(field in TEXT_FIELDS)) {
      await send(ctx, "فیلد نامعتبر است.");
      return true;
    }
    const value = truncate(text.trim(), 2000);
    if (value.length < 1) {
      await send(ctx, "متن خالی است.");
      return true;
    }
    await updateRows(ctx.sb, "group_settings", {
      [field]: value,
      updated_at: new Date().toISOString(),
    }, { group_id: groupId });
    await logAdminAction(ctx, "group_text_update", "group", groupId, { field });
    await send(ctx, "✅ متن ذخیره شد.");
    await renderGroup(ctx, groupId);
    return true;
  }

  const meta = INT_FIELDS[field];
  if (!meta) {
    await send(ctx, "فیلد نامعتبر است.");
    return true;
  }
  const value = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isInteger(value) || value < meta.min || value > meta.max) {
    await send(ctx, `⚠️ عدد باید بین ${faNum(meta.min)} و ${faNum(meta.max)} باشد.`);
    return true;
  }
  await updateRows(ctx.sb, "group_settings", {
    [field]: value,
    updated_at: new Date().toISOString(),
  }, { group_id: groupId });
  await logAdminAction(ctx, "group_int_update", "group", groupId, { field, value });
  await send(ctx, "✅ مقدار ذخیره شد.");
  await renderGroup(ctx, groupId);
  return true;
}

export { TEXT_FIELDS, TOGGLE_FIELDS };
