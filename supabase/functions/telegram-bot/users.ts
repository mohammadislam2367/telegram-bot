/** 👥 مدیریت کاربران + 🚫 مسدودسازی سطح ربات (متفاوت از Ban گروه). */
import {
  callRpc,
  countRows,
  deleteRows,
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from "../_shared/db.ts";
import { getAdmin, ROLE_LABELS } from "../_shared/auth.ts";
import { keyboard } from "../_shared/keyboards.ts";
import {
  displayName,
  divider,
  faDateTime,
  faNum,
  relativeFa,
  sectionTitle,
} from "../_shared/texts.ts";
import { startOfDayIso } from "../_shared/rate_limit.ts";
import { escapeHtml, parseTelegramId, truncate } from "../_shared/validation.ts";
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
import type { BanRow, UserRow } from "../_shared/types.ts";

function usersMenuKeyboard(): ReturnType<typeof keyboard> {
  return keyboard([
    [
      { text: "🔍 جستجوی کاربر", callback_data: "a:us:s" },
      { text: "🆕 کاربران امروز", callback_data: "a:us:n" },
    ],
    [
      { text: "🟢 فعالان ۷ روز", callback_data: "a:us:a" },
      { text: "🗂 آخرین کاربران", callback_data: "a:us:l" },
    ],
    [
      { text: "🚫 لیست مسدودها", callback_data: "a:bn" },
      { text: "📊 آمار کاربران", callback_data: "a:st" },
    ],
    [{ text: "🏠 داشبورد", callback_data: "a:h" }],
  ]);
}

export async function isUserBanned(
  ctx: Ctx,
  userId: number,
): Promise<{ banned: boolean; reason?: string }> {
  const ban = await selectOne<BanRow>(
    ctx.sb,
    "banned_users",
    (q) => q.eq("user_id", userId).eq("is_active", true),
  );
  if (!ban) return { banned: false };
  if (ban.expires_at && new Date(ban.expires_at).getTime() <= ctx.now.getTime()) {
    return { banned: false };
  }
  return { banned: true, reason: ban.reason ?? undefined };
}

async function renderUsersMenu(ctx: Ctx): Promise<void> {
  const timeZone = await ctx.settings.get("timezone");
  const todayStart = startOfDayIso(timeZone, ctx.now);
  const weekAgo = new Date(ctx.now.getTime() - 7 * 86_400_000).toISOString();
  const [total, today, active, blocked] = await Promise.all([
    countRows(ctx.sb, "users"),
    countRows(ctx.sb, "users", (q) => q.gte("created_at", todayStart)),
    countRows(ctx.sb, "users", (q) => q.gte("last_seen_at", weekAgo)),
    countRows(ctx.sb, "banned_users", (q) => q.eq("is_active", true)),
  ]);

  const text = [
    sectionTitle("👥 مدیریت کاربران"),
    divider(),
    `کل کاربران: <b>${faNum(total)}</b>`,
    `جدید امروز: <b>${faNum(today)}</b>`,
    `فعال ۷ روز: <b>${faNum(active)}</b>`,
    `مسدود از ربات: <b>${faNum(blocked)}</b>`,
    "",
    "<i>مسدودسازی این بخش فقط دسترسی به ربات را می‌بندد و با Ban در گروه تفاوت دارد.</i>",
  ].join("\n");
  await editOrSend(ctx, text, usersMenuKeyboard());
}

async function listUsers(
  ctx: Ctx,
  title: string,
  filter: "today" | "active" | "latest",
): Promise<void> {
  const timeZone = await ctx.settings.get("timezone");
  const weekAgo = new Date(ctx.now.getTime() - 7 * 86_400_000).toISOString();
  const users = await selectRows<UserRow>(ctx.sb, "users", (q) => {
    let query = q.order("last_seen_at", { ascending: false });
    if (filter === "today") {
      query = query.gte("created_at", startOfDayIso(timeZone, ctx.now));
    } else if (filter === "active") {
      query = query.gte("last_seen_at", weekAgo);
    }
    return query.limit(10);
  });

  if (users.length === 0) {
    await editOrSend(
      ctx,
      `<b>${title}</b>\n\n<i>کاربری پیدا نشد.</i>`,
      keyboard([
        [{ text: "◀️ بازگشت", callback_data: "a:us" }],
      ]),
    );
    return;
  }

  const lines = users.map((user, index) =>
    `${faNum(index + 1)}. ${
      escapeHtml(displayName(user))
    } — <code>${user.telegram_id}</code>\n    ${relativeFa(user.last_seen_at, ctx.now)}`
  );
  const rows = [];
  for (let i = 0; i < users.length; i += 2) {
    rows.push(
      users.slice(i, i + 2).map((user) => ({
        text: displayName(user).slice(0, 22),
        callback_data: `a:u:${user.telegram_id}`,
      })),
    );
  }
  rows.push([{ text: "◀️ بازگشت", callback_data: "a:us" }]);

  await editOrSend(ctx, `<b>${title}</b>\n${divider()}\n${lines.join("\n")}`, keyboard(rows));
}

export async function renderUserCard(ctx: Ctx, telegramId: number): Promise<void> {
  const user = await selectOne<UserRow>(ctx.sb, "users", (q) => q.eq("telegram_id", telegramId));
  if (!user) {
    await editOrSend(
      ctx,
      `کاربر <code>${telegramId}</code> در دیتابیس نیست.`,
      keyboard([
        [{ text: "◀️ بازگشت", callback_data: "a:us" }],
      ]),
    );
    return;
  }

  const timeZone = await ctx.settings.get("timezone");
  const limit = await ctx.settings.get("ai_daily_limit");
  const [ban, todayAi, adminRow, warnings] = await Promise.all([
    selectOne<BanRow>(
      ctx.sb,
      "banned_users",
      (q) => q.eq("user_id", telegramId).eq("is_active", true),
    ),
    countRows(ctx.sb, "ai_usage", (q) =>
      q.eq("user_id", telegramId)
        .eq("request_type", "chat")
        .gte("created_at", startOfDayIso(timeZone, ctx.now))),
    selectOne<{ role: string; is_active: boolean }>(
      ctx.sb,
      "admins",
      (q) => q.eq("user_id", telegramId),
    ),
    countRows(ctx.sb, "user_warnings", (q) => q.eq("user_id", telegramId).eq("is_active", true)),
  ]);

  const lines = [
    sectionTitle("👤 کارت کاربر"),
    divider(),
    `نام: <b>${escapeHtml(displayName(user))}</b>`,
    `شناسه: <code>${user.telegram_id}</code>`,
    user.username ? `یوزرنیم: @${escapeHtml(user.username)}` : "یوزرنیم: —",
    `زبان: ${user.language_code ?? "—"}${user.is_premium ? " • پریمیوم ⭐" : ""}`,
    "",
    `📅 عضویت: ${faDateTime(user.created_at, timeZone)}`,
    `👀 آخرین فعالیت: ${relativeFa(user.last_seen_at, ctx.now)}`,
    `💬 پیام‌ها: ${faNum(user.message_count)}`,
    `🤖 درخواست AI امروز: ${faNum(todayAi)} / ${faNum(limit)}`,
    `📢 دریافت پیام همگانی: ${user.broadcast_opt_in ? "بله ✅" : "خیر 🔕"}`,
    `⚠️ اخطار فعال در گروه‌ها: ${faNum(warnings)}`,
    ban
      ? `🚫 مسدود از ربات: <b>بله</b>\n    دلیل: ${escapeHtml(ban.reason ?? "—")}\n    تاریخ: ${
        faDateTime(ban.created_at, timeZone)
      }`
      : "🚫 مسدود از ربات: خیر",
    adminRow
      ? `🎖 نقش مدیریتی: ${ROLE_LABELS[adminRow.role as keyof typeof ROLE_LABELS] ?? adminRow.role}${
        adminRow.is_active ? "" : " (غیرفعال)"
      }`
      : "",
    user.notes ? `📝 یادداشت: ${escapeHtml(truncate(user.notes, 300))}` : "📝 یادداشت: —",
  ].filter(Boolean);

  const actions = [];
  if (ban) {
    actions.push([{ text: "✅ رفع مسدودسازی", callback_data: `a:u:${telegramId}:u` }]);
  } else {
    actions.push([{ text: "🚫 مسدود کردن از ربات", callback_data: `a:u:${telegramId}:b` }]);
  }
  actions.push([
    { text: "📝 افزودن یادداشت", callback_data: `a:u:${telegramId}:n` },
    { text: "🧹 پاک‌کردن حافظه", callback_data: `a:u:${telegramId}:m` },
  ]);
  actions.push([{ text: "🗑 حذف کامل داده‌ها", callback_data: `a:u:${telegramId}:d` }]);
  actions.push([
    { text: "🔄 به‌روزرسانی", callback_data: `a:u:${telegramId}` },
    { text: "👥 کاربران", callback_data: "a:us" },
  ]);

  await editOrSend(ctx, lines.join("\n"), keyboard(actions));
}

export async function renderBansList(ctx: Ctx): Promise<void> {
  const timeZone = await ctx.settings.get("timezone");
  const bans = await selectRows<BanRow>(
    ctx.sb,
    "banned_users",
    (q) => q.eq("is_active", true).order("created_at", { ascending: false }).limit(10),
  );

  if (bans.length === 0) {
    await editOrSend(
      ctx,
      [
        sectionTitle("🚫 مدیریت مسدودسازی"),
        divider(),
        "<i>هیچ کاربری از ربات مسدود نیست. 🎉</i>",
      ].join("\n"),
      keyboard([
        [{ text: "👥 کاربران", callback_data: "a:us" }],
        [{ text: "🏠 داشبورد", callback_data: "a:h" }],
      ]),
    );
    return;
  }

  const users = await selectRows<UserRow>(
    ctx.sb,
    "users",
    (q) => q.in("telegram_id", bans.map((ban) => ban.user_id)),
  );
  const userMap = new Map(users.map((user) => [user.telegram_id, user]));

  const lines = bans.map((ban, index) => {
    const user = userMap.get(ban.user_id);
    return `${faNum(index + 1)}. ${
      escapeHtml(user ? displayName(user) : String(ban.user_id))
    } — <code>${ban.user_id}</code>\n    دلیل: ${escapeHtml(ban.reason ?? "—")} • ${
      faDateTime(ban.created_at, timeZone)
    }`;
  });

  const rows = bans.map((ban) => [
    { text: `👤 ${ban.user_id}`, callback_data: `a:u:${ban.user_id}` },
    { text: "✅ رفع مسدودی", callback_data: `a:bn:u:${ban.user_id}` },
  ]);
  rows.push([{ text: "🏠 داشبورد", callback_data: "a:h" }]);

  await editOrSend(
    ctx,
    [
      sectionTitle("🚫 مسدودان ربات"),
      divider(),
      ...lines,
      "",
      "<i>این لیست با Ban اعضای گروه تفاوت دارد.</i>",
    ].join("\n"),
    keyboard(rows),
  );
}

export async function handleUsersCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  const key = parts[1];
  if (key !== "us" && key !== "u" && key !== "bn") return false;

  if (key === "us") {
    if (!(await guardAdmin(ctx, "users.read"))) return true;
    const sub = parts[2];
    if (!sub) {
      await renderUsersMenu(ctx);
      return true;
    }
    if (sub === "s") {
      await askForInput(
        ctx,
        "admin_users_search",
        "🔍 <b>جستجوی کاربر</b>\nشناسه‌ی عددی تلگرام یا @username را بفرستید.",
        {},
        "a:us",
      );
      return true;
    }
    if (sub === "n") {
      await listUsers(ctx, "🆕 کاربران امروز", "today");
      return true;
    }
    if (sub === "a") {
      await listUsers(ctx, "🟢 فعالان ۷ روز", "active");
      return true;
    }
    if (sub === "l") {
      await listUsers(ctx, "🗂 آخرین کاربران", "latest");
      return true;
    }
    return false;
  }

  if (key === "u") {
    if (!(await guardAdmin(ctx, "users.read"))) return true;
    const userId = parseTelegramId(parts[2] ?? "");
    if (!userId) {
      await answerCallback(ctx, "شناسه نامعتبر است.", true);
      return true;
    }
    const action = parts[3];

    if (!action) {
      await renderUserCard(ctx, userId);
      return true;
    }

    if (action === "b") {
      if (!(await guardAdmin(ctx, "bans.manage"))) return true;
      const banned = await isUserBanned(ctx, userId);
      if (banned.banned) {
        await answerCallback(ctx, "این کاربر از قبل مسدود است.", true);
        return true;
      }
      await askForInput(
        ctx,
        "admin_user_reason_ban",
        `🚫 <b>مسدودسازی کاربر</b> <code>${userId}</code>\nدلیل را بنویسید (یا <code>-</code> برای بدون دلیل).`,
        { userId },
        `a:u:${userId}`,
      );
      return true;
    }

    if (action === "u") {
      if (!(await guardAdmin(ctx, "bans.manage"))) return true;
      const ban = await selectOne<BanRow>(
        ctx.sb,
        "banned_users",
        (q) => q.eq("user_id", userId).eq("is_active", true),
      );
      if (!ban) {
        await answerCallback(ctx, "این کاربر مسدود نیست.", true);
        return true;
      }
      await askConfirm(
        ctx,
        `✅ <b>رفع مسدودسازی</b>\nکاربر <code>${userId}</code> دوباره به ربات دسترسی پیدا می‌کند.`,
        "user_unban",
        { userId },
        `a:u:${userId}`,
      );
      return true;
    }

    if (action === "n") {
      if (!(await guardAdmin(ctx, "users.manage"))) return true;
      await askForInput(
        ctx,
        "admin_user_note",
        `📝 <b>یادداشت مدیریتی</b> برای <code>${userId}</code>\nمتن یادداشت را بفرستید (حداکثر ۵۰۰ کاراکتر).`,
        { userId },
        `a:u:${userId}`,
      );
      return true;
    }

    if (action === "m") {
      if (!(await guardAdmin(ctx, "users.manage"))) return true;
      try {
        const deleted = await callRpc<number>(ctx.sb, "trim_conversation", {
          p_user_id: userId,
          p_keep: 2,
        });
        await logAdminAction(ctx, "user_memory_clear", "user", userId, { deleted });
        await answerCallback(ctx, "حافظه‌ی AI کاربر پاک شد.");
        await renderUserCard(ctx, userId);
      } catch (error) {
        await answerCallback(ctx, `خطا: ${truncate((error as Error).message, 100)}`, true);
      }
      return true;
    }

    if (action === "d") {
      if (!(await guardAdmin(ctx, "users.manage"))) return true;
      await askConfirm(
        ctx,
        [
          "🗑 <b>حذف کامل داده‌های کاربر</b>",
          `کاربر <code>${userId}</code> و همه‌ی داده‌های مرتبط (حافظه AI، اشتراک پیام، اخطارها) حذف می‌شود.`,
          "این عملیات قابل بازگشت نیست.",
        ].join("\n"),
        "user_delete",
        { userId },
        "a:us",
      );
      return true;
    }

    await answerCallback(ctx, "اقدام ناشناخته است.", true);
    return true;
  }

  if (key === "bn") {
    if (!(await guardAdmin(ctx, "bans.manage"))) return true;
    const sub = parts[2];
    if (sub === "u") {
      const userId = parseTelegramId(parts[3] ?? "");
      if (!userId) {
        await answerCallback(ctx, "شناسه نامعتبر است.", true);
        return true;
      }
      await askConfirm(
        ctx,
        `✅ رفع مسدودسازی کاربر <code>${userId}</code>؟`,
        "user_unban",
        { userId },
        "a:bn",
      );
      return true;
    }
    await renderBansList(ctx);
    return true;
  }

  return false;
}

// ─── input handlers ──────────────────────────────────────────────────────────

export async function handleUsersInput(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  if (action === "admin_users_search") {
    if (!(await guardAdmin(ctx, "users.read"))) return true;
    const numeric = parseTelegramId(text);
    let user: UserRow | null = null;

    if (numeric) {
      user = await selectOne<UserRow>(ctx.sb, "users", (q) => q.eq("telegram_id", numeric));
    } else if (text.trim().startsWith("@")) {
      const username = text.trim().slice(1, 64);
      user = await selectOne<UserRow>(ctx.sb, "users", (q) => q.ilike("username", username));
    }

    if (!user) {
      await send(ctx, "❌ کاربری با این مشخصات پیدا نشد. دوباره تلاش کنید یا /cancel بزنید.");
      return true;
    }
    await renderUserCard(ctx, user.telegram_id);
    return true;
  }

  if (action === "admin_user_reason_ban") {
    if (!(await guardAdmin(ctx, "bans.manage"))) return true;
    const userId = Number(args.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      await send(ctx, "شناسه‌ی کاربر نامعتبر است.");
      return true;
    }
    const reason = text.trim() === "-" ? null : truncate(text.trim(), 300);
    await askConfirm(
      ctx,
      `🚫 <b>تأیید مسدودسازی</b>\nکاربر: <code>${userId}</code>\nدلیل: ${
        escapeHtml(reason ?? "—")
      }`,
      "user_ban",
      { userId, reason },
      `a:u:${userId}`,
    );
    return true;
  }

  if (action === "admin_user_note") {
    if (!(await guardAdmin(ctx, "users.manage"))) return true;
    const userId = Number(args.userId);
    const note = truncate(text.trim(), 500);
    if (note.length === 0) {
      await send(ctx, "یادداشت خالی است.");
      return true;
    }
    await updateRows(ctx.sb, "users", {
      notes: note,
      updated_at: new Date().toISOString(),
    }, { telegram_id: userId });
    await logAdminAction(ctx, "user_note", "user", userId, { note });
    await send(ctx, "✅ یادداشت ذخیره شد:\n" + escapeHtml(note));
    await renderUserCard(ctx, userId);
    return true;
  }

  return false;
}

// ─── confirms ────────────────────────────────────────────────────────────────

export async function runUserConfirm(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (action === "user_ban") {
    if (!(await guardAdmin(ctx, "bans.manage"))) return true;
    const userId = Number(args.userId);
    const reason = args.reason ? String(args.reason) : null;

    await insertRow(ctx.sb, "banned_users", {
      user_id: userId,
      banned_by: ctx.userId,
      reason,
      is_active: true,
    });
    await logAdminAction(ctx, "user_ban", "user", userId, { reason });
    await send(ctx, `🚫 کاربر <code>${userId}</code> از ربات مسدود شد.`);
    await renderUserCard(ctx, userId);
    return true;
  }

  if (action === "user_unban") {
    if (!(await guardAdmin(ctx, "bans.manage"))) return true;
    const userId = Number(args.userId);
    const rows = await updateRows(ctx.sb, "banned_users", {
      is_active: false,
      lifted_at: new Date().toISOString(),
      lifted_by: ctx.userId,
    }, { user_id: userId, is_active: true });
    await logAdminAction(ctx, "user_unban", "user", userId, { rows: rows.length });
    await send(
      ctx,
      rows.length > 0
        ? `✅ مسدودسازی کاربر <code>${userId}</code> برداشته شد.`
        : "این کاربر مسدود نبود.",
    );
    if (ctx.update.callback_query) await renderBansList(ctx);
    return true;
  }

  if (action === "user_delete") {
    if (!(await guardAdmin(ctx, "users.manage"))) return true;
    const userId = Number(args.userId);
    const ok = await callRpc<boolean>(ctx.sb, "purge_user", { p_telegram_id: userId });
    await logAdminAction(ctx, "user_delete", "user", userId, { ok });
    await send(ctx, ok ? "🗑 داده‌های کاربر حذف شد." : "کاربر پیدا نشد.");
    return true;
  }

  return false;
}

// ─── user-facing ─────────────────────────────────────────────────────────────

export async function renderProfile(ctx: Ctx): Promise<void> {
  const timeZone = await ctx.settings.get("timezone");
  const limit = await ctx.settings.get("ai_daily_limit");
  const todayAi = await countRows(ctx.sb, "ai_usage", (q) =>
    q.eq("user_id", ctx.userId)
      .eq("request_type", "chat")
      .gte("created_at", startOfDayIso(timeZone, ctx.now)));

  const text = [
    sectionTitle("👤 پروفایل من"),
    divider(),
    `نام: <b>${escapeHtml(displayName(ctx.user))}</b>`,
    `شناسه: <code>${ctx.userId}</code>`,
    `عضویت: ${faDateTime(ctx.user.created_at, timeZone)}`,
    `پیام‌های ارسالی: ${faNum(ctx.user.message_count)}`,
    `درخواست AI امروز: ${faNum(todayAi)} / ${faNum(limit)}`,
    `دریافت پیام همگانی: ${ctx.user.broadcast_opt_in ? "فعال ✅" : "غیرفعال 🔕"}`,
    `حافظه‌ی AI: ${ctx.user.ai_memory_enabled ? "روشن" : "خاموش"}`,
  ].join("\n");

  const rows = [
    [{
      text: ctx.user.broadcast_opt_in ? "🔕 توقف پیام‌ها" : "🔔 فعال‌کردن پیام‌ها",
      callback_data: "u:tg",
    }],
    [
      { text: "🧹 پاک‌کردن حافظه‌ی AI", callback_data: "u:mm" },
      { text: "🗑 حذف داده‌های من", callback_data: "u:dl" },
    ],
    [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
  ];

  if (ctx.update.callback_query) await editOrSend(ctx, text, keyboard(rows));
  else await send(ctx, text, keyboard(rows));
}

export async function commandPrivacy(ctx: Ctx): Promise<void> {
  const text = [
    sectionTitle("🔐 حریم خصوصی"),
    divider(),
    "چه چیزی ذخیره می‌شود؟",
    "• شناسه‌ی تلگرام، نام و یوزرنیم عمومی",
    "• زمان عضویت/آخرین فعالیت و شمارنده‌ها",
    "• اگر از چت هوشمند استفاده کنید: متن گفت‌وگو برای حافظه",
    "",
    "چه چیزی ذخیره <b>نمی‌شود</b>؟",
    "• متن پیام‌های معمولی شما",
    "• مخاطبین، شماره تلفن یا فایل‌ها",
    "",
    "• با /deletedata می‌توانید همه‌ی داده‌های خود را حذف کنید.",
    "• با /stop دریافت پیام‌های همگانی را متوقف کنید.",
    "• داده‌ها هرگز فروخته نمی‌شوند.",
  ].join("\n");
  await send(
    ctx,
    text,
    keyboard([
      [{ text: "🗑 حذف داده‌های من", callback_data: "u:dl" }],
      [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
    ]),
  );
}

export async function commandStop(ctx: Ctx): Promise<void> {
  await updateRows(ctx.sb, "users", {
    broadcast_opt_in: false,
    updated_at: new Date().toISOString(),
  }, { telegram_id: ctx.userId });
  await send(ctx, "🔕 دریافت پیام‌های همگانی متوقف شد. با /start دوباره فعال می‌شود.");
}

export async function commandStartOptIn(ctx: Ctx): Promise<void> {
  if (!ctx.user.broadcast_opt_in) {
    await updateRows(ctx.sb, "users", {
      broadcast_opt_in: true,
      broadcast_opt_in_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { telegram_id: ctx.userId });
  }
}

export async function commandDeleteDataRequest(ctx: Ctx): Promise<void> {
  await send(
    ctx,
    "🗑 <b>حذف کامل داده‌ها</b>\nبا تأیید، حساب شما در ربات و همه‌ی داده‌های مرتبط حذف می‌شود. این کار قابل بازگشت نیست.",
    keyboard([
      [
        { text: "✅ بله، حذف کن", callback_data: "u:dly" },
        { text: "❌ انصراف", callback_data: "u:dln" },
      ],
    ]),
  );
}

export async function handleUserSelfCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  const action = parts[1];

  if (action === "pr") {
    await renderProfile(ctx);
    return true;
  }

  if (action === "tg") {
    const next = !ctx.user.broadcast_opt_in;
    await updateRows(ctx.sb, "users", {
      broadcast_opt_in: next,
      broadcast_opt_in_at: next ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { telegram_id: ctx.userId });
    ctx.user.broadcast_opt_in = next;
    await answerCallback(ctx, next ? "پیام‌ها فعال شد." : "پیام‌ها متوقف شد.");
    await renderProfile(ctx);
    return true;
  }

  if (action === "mm") {
    try {
      await callRpc<number>(ctx.sb, "trim_conversation", { p_user_id: ctx.userId, p_keep: 2 });
      await answerCallback(ctx, "حافظه‌ی گفت‌وگو پاک شد.");
    } catch {
      await answerCallback(ctx, "خطا در پاک‌کردن حافظه.", true);
    }
    return true;
  }

  if (action === "dl") {
    await commandDeleteDataRequest(ctx);
    return true;
  }

  if (action === "dln") {
    await clearUserSessionUi(ctx);
    await answerCallback(ctx, "انصراف ثبت شد.");
    await renderProfile(ctx);
    return true;
  }

  if (action === "dly") {
    const ok = await callRpc<boolean>(ctx.sb, "purge_user", { p_telegram_id: ctx.userId });
    await clearUserSessionUi(ctx);
    await editOrSend(
      ctx,
      ok
        ? "✅ داده‌های شما حذف شد. اگر دوباره /start بزنید، حساب تازه ساخته می‌شود. خدانگهدار 🌸"
        : "داده‌ای برای حذف پیدا نشد.",
    );
    return true;
  }

  return false;
}

async function clearUserSessionUi(ctx: Ctx): Promise<void> {
  try {
    await deleteRows(ctx.sb, "bot_sessions", { telegram_id: ctx.userId, chat_id: ctx.chatId });
  } catch {
    // ignore
  }
}

export async function adminLookupForUser(ctx: Ctx, userId: number) {
  return await getAdmin(ctx.sb, userId, ctx.cfg.superAdminIds);
}
