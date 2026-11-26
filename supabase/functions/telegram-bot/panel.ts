/**
 * پنل مدیریت گروه — همهٔ صفحه‌ها با دکمه‌های شیشه‌ای، به سبک دیجی‌انتی.
 * کال‌بک‌ها: p:<section>[:arg]
 */
import {
  answerCallback,
  btn,
  card,
  type Cfg,
  dbCount,
  deleteMessage,
  editMessage,
  esc,
  faNum,
  kb,
  type Markup,
  mention,
  on,
  sendMessage,
  setPermissions,
  tg,
  type TgCallback,
  type TgMessage,
  unbanMember,
  urlBtn,
} from "./core.ts";
import {
  ALL_PERMISSIONS,
  buildPermissions,
  hasPermissionLocks,
  LOCK_DEFS,
  lockKey,
  normalizeLocks,
} from "./locks.ts";
import {
  isGroupAdmin,
  listStaff,
  listWords,
  loadSettings,
  removeWord,
  saveSettings,
  type Settings,
} from "./store.ts";

export const WELCOME_TEMPLATES: readonly { label: string; text: string }[] = [
  { label: "🎗 کلاسیک", text: "👋 {name} عزیز به {group} خوش آمدی!\n🕒 {TIME} · 📅 {DATE}" },
  { label: "✨ معرفی", text: "✨ {name} خوش آمدی!\n🔗 خودت را معرفی کن: نام / سن / شهر" },
  {
    label: "🏷 کارتی",
    text: "🎗 <b>{FIRST_NAME}</b> به {group} پیوست\n🧑 شناسه: <code>{USERID}</code>\n🕒 {TIME}",
  },
];

const PAGE = 10;
const FLOOD_LIMITS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 60];
const FLOOD_WINDOWS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600];
const MUTE_STEPS = [1, 5, 10, 15, 30, 60, 120, 1440];

export function backRow(target = "p:m"): ReturnType<typeof btn>[] {
  return [btn("↩️ بازگشت", target), btn("❌ بستن", "p:q")];
}

function faAction(action: Settings["warn_action"]): string {
  return action === "kick" ? "اخراج" : action === "ban" ? "بن" : "سکوت";
}

function step(steps: readonly number[], current: number, delta: number): number {
  const index = steps.indexOf(current);
  const base = index === -1 ? Math.max(0, steps.findIndex((value) => value >= current)) : index;
  return steps[Math.max(0, Math.min(steps.length - 1, base + delta))];
}

export function mainScreen(settings: Settings): string {
  const locks = normalizeLocks(settings.locks);
  const active = Object.keys(locks).length;
  return card("🛡 <b>پنل مدیریت اسپیکسل</b>", [
    `١. قفل‌ها: ${on(active > 0)} ${faNum(active)} فعال از ${faNum(LOCK_DEFS.length)}`,
    `٢. ضدلینک ${on(settings.antilink_enabled)} · ضداسپم ${on(settings.antispam_enabled)}`,
    `٣. خوشامد ${on(settings.welcome_enabled)} · ضدفوروارد ${on(settings.block_forwards)}`,
    `٤. تأیید ${on(settings.verify_enabled)} · سخت‌گیرانه ${on(settings.strict_mode)}`,
    `٥. مجازات: ${faNum(settings.warn_limit)} اخطار → ${faAction(settings.warn_action)}`,
    "",
    "بخش مورد نظر را از دکمه‌ها انتخاب کن.",
  ]);
}

export function mainMarkup(isGroup: boolean): Markup {
  const rows = [
    [btn("🔐 قفل‌ها", "p:l:0"), btn("🧠 اتوماسیون", "p:a")],
    [btn("⚠️ مجازات‌ها", "p:pun"), btn("👮 مدیران", "p:s")],
    [btn("🔤 فیلتر کلمات", "p:f"), btn("📊 آمار", "p:st")],
    [btn("🧹 پاک‌سازی", "p:pg"), btn("🌊 ضد فلوود", "p:fl")],
    [btn("👋 خوش‌آمد", "p:wl"), btn("📜 قوانین", "p:rules")],
    [btn("ℹ️ راهنما", "p:help"), btn("❌ بستن", "p:q")],
  ];
  if (!isGroup) rows.push([btn("➕ افزودن به گروه", "p:grp")]);
  return kb(rows);
}

export function locksView(settings: Settings, page: number): { text: string; markup: Markup } {
  const locks = normalizeLocks(settings.locks);
  const pages = Math.max(1, Math.ceil(LOCK_DEFS.length / PAGE));
  const safe = Math.max(0, Math.min(page, pages - 1));
  const slice = LOCK_DEFS.slice(safe * PAGE, safe * PAGE + PAGE);
  const rows = [];
  for (let index = 0; index < slice.length; index += 2) {
    rows.push(
      slice.slice(index, index + 2).map((def) =>
        btn(`${locks[def.key] ? "✅" : "🔒"} ${def.emoji} ${def.label}`, `p:t:${def.key}:${safe}`)
      ),
    );
  }
  const nav = [];
  if (safe > 0) nav.push(btn("◀️", `p:l:${safe - 1}`));
  nav.push(btn(`صفحهٔ ${faNum(safe + 1)}/${faNum(pages)}`, `p:l:${safe}`));
  if (safe < pages - 1) nav.push(btn("▶️", `p:l:${safe + 1}`));
  rows.push(nav);
  rows.push([btn("🔴 همه بسته", "p:all:off"), btn("🟢 همه باز", "p:all:on")]);
  rows.push(backRow());

  const text = card("🔐 <b>قفل‌های گروه</b>", [
    `فعال: <b>${faNum(Object.keys(locks).length)}</b> از ${faNum(LOCK_DEFS.length)}`,
    "روی هر دکمه بزن تا همان قفل روشن/خاموش شود.",
    "",
    "دستور متنی: <code>قفل لینک</code> · <code>بازکردن لینک</code> · <code>قفل ها</code>",
  ]);
  return { text, markup: kb(rows) };
}

function automationView(settings: Settings): { text: string; markup: Markup } {
  const items: [keyof Settings, string, boolean][] = [
    ["antilink_enabled", "🔗 ضدلینک", settings.antilink_enabled],
    ["antispam_enabled", "🧹 ضداسپم و فلوود", settings.antispam_enabled],
    ["block_forwards", "📤 ضدفوروارد", settings.block_forwards],
    ["welcome_enabled", "👋 خوشامد", settings.welcome_enabled],
    ["verify_enabled", "✅ تأیید هویت", settings.verify_enabled],
    ["strict_mode", "🛡 حالت سخت‌گیرانه", settings.strict_mode],
    ["delete_warn_messages", "🗑 حذف پیام اخطارها", settings.delete_warn_messages],
  ];
  return {
    text: card("🧠 <b>اتوماسیون گروه</b>", [
      "هر دکمه را بزن تا فوراً روشن/خاموش شود.",
      "",
      `خوشامد: ${on(settings.welcome_enabled)} · تأیید: ${on(settings.verify_enabled)}`,
      "روشن‌بودن ضداسپم، ضدفیشینگ را هم فعال می‌کند.",
    ]),
    markup: kb([
      ...items.map((
        [field, label, value],
      ) => [btn(`${value ? "🟢" : "🔴"} ${label}`, `p:x:${field}`)]),
      backRow(),
    ]),
  };
}

function punishView(settings: Settings): { text: string; markup: Markup } {
  const order: Settings["warn_action"][] = ["mute", "kick", "ban"];
  const next = order[(order.indexOf(settings.warn_action) + 1) % order.length];
  return {
    text: card("⚠️ <b>مجازات‌ها</b>", [
      `سقف اخطار: <b>${faNum(settings.warn_limit)}</b>`,
      `مجازات: <b>${faAction(settings.warn_action)}</b>`,
      `مدت سکوت: <b>${faNum(settings.mute_duration_minutes)}</b> دقیقه`,
    ]),
    markup: kb([
      [
        btn("➖ اخطار", "p:warn:-"),
        btn(`سقف: ${faNum(settings.warn_limit)}`, "p:pun"),
        btn("➕ اخطار", "p:warn:+"),
      ],
      [btn(`🔄 مجازات: ${faAction(next)}`, `p:act:${next}`)],
      [
        btn("➖ مدت", "p:mute:-"),
        btn(`${faNum(settings.mute_duration_minutes)} دقیقه`, "p:pun"),
        btn("➕ مدت", "p:mute:+"),
      ],
      backRow(),
    ]),
  };
}

function staffView(rows: Awaited<ReturnType<typeof listStaff>>): { text: string; markup: Markup } {
  const admins = rows.filter((row) => row.role === "admin");
  const vips = rows.filter((row) => row.role === "vip");
  const line = (row: { user_id: number }) => `• <code>${row.user_id}</code>`;
  return {
    text: card("👮 <b>مدیران و ویژه‌ها</b>", [
      `مدیران (${faNum(admins.length)}):`,
      ...(admins.length ? admins.slice(0, 12).map(line) : ["— هیچ مدیری ثبت نشده"]),
      "",
      `ویژه‌ها (${faNum(vips.length)}):`,
      ...(vips.length ? vips.slice(0, 12).map(line) : ["— هیچ کاربر ویژه‌ای ثبت نشده"]),
      "",
      "افزودن با ریپلای: <code>افزودن مدیر</code> · <code>افزودن ویژه</code>",
      "حذف با ریپلای: <code>عزل مدیر</code> · <code>عزل ویژه</code>",
    ]),
    markup: kb([[btn("🔄 به‌روزرسانی", "p:s"), btn("📋 راهنما", "p:help")], backRow()]),
  };
}

async function filterView(
  cfg: Cfg,
  chatId: number,
): Promise<{ text: string; markup: Markup }> {
  const words = await listWords(cfg, chatId);
  const rows = [];
  for (let index = 0; index < words.length; index += 2) {
    rows.push(
      words.slice(index, index + 2).map((row) =>
        btn(`🗑 ${row.word.slice(0, 14)}`, `p:fr:${row.id}`)
      ),
    );
  }
  rows.push([btn("🔄 به‌روزرسانی", "p:f")]);
  rows.push(backRow());
  return {
    text: card("🔤 <b>فیلتر کلمات</b>", [
      `تعداد کلمه‌های فیلترشده: <b>${faNum(words.length)}</b>`,
      words.length ? "برای حذف هر کلمه روی دکمهٔ آن بزن." : "هنوز کلمه‌ای ثبت نشده.",
      "",
      "افزودن: <code>فیلتر کردن کلمه</code> · حذف: <code>حذف فیلتر کلمه</code>",
    ]),
    markup: kb(rows),
  };
}

async function statsView(
  cfg: Cfg,
  chatId: number,
  settings: Settings,
): Promise<{ text: string; markup: Markup }> {
  const [staff, words, warns, bans, groups, users] = await Promise.all([
    dbCount(cfg, "group_staff", `group_id=eq.${chatId}`),
    dbCount(cfg, "group_words", `group_id=eq.${chatId}`),
    dbCount(cfg, "user_warnings", `group_id=eq.${chatId}&is_active=eq.true`),
    dbCount(cfg, "group_bans", `group_id=eq.${chatId}&is_active=eq.true`),
    dbCount(cfg, "groups", "is_active=eq.true"),
    dbCount(cfg, "users"),
  ]);
  return {
    text: card("📊 <b>آمار</b>", [
      `گروه‌های فعال ربات: <b>${faNum(groups)}</b> · کاربران: <b>${faNum(users)}</b>`,
      `قفل فعال: <b>${faNum(Object.keys(normalizeLocks(settings.locks)).length)}</b>`,
      `مدیر/ویژه: <b>${faNum(staff)}</b> · کلمات فیلتر: <b>${faNum(words)}</b>`,
      `اخطار فعال: <b>${faNum(warns)}</b> · بن/سکوت فعال: <b>${faNum(bans)}</b>`,
    ]),
    markup: kb([[btn("🔄 به‌روزرسانی", "p:st"), btn("🔐 قفل‌ها", "p:l:0")], backRow()]),
  };
}

function welcomeView(settings: Settings): { text: string; markup: Markup } {
  const rows = [
    [btn(`${settings.welcome_enabled ? "🟢 روشن" : "🔴 خاموش"} — خوش‌آمد`, "p:wg")],
  ];
  WELCOME_TEMPLATES.forEach((template, index) => {
    rows.push([btn(`📄 ${template.label}`, `p:wt:${index}`)]);
  });
  rows.push(backRow());
  return {
    text: card("👋 <b>خوش‌آمد</b>", [
      `وضعیت: ${on(settings.welcome_enabled)}`,
      "",
      "متن فعلی:",
      `<i>${esc(settings.welcome_text)}</i>`,
      "",
      "متغیرها: <code>{name}</code> · <code>{group}</code> · <code>{TIME}</code> · " +
      "<code>{DATE}</code> · <code>{USERID}</code>",
      "متن دلخواه: <code>خوشامد متن …</code>",
    ]),
    markup: kb(rows),
  };
}

function floodView(settings: Settings): { text: string; markup: Markup } {
  return {
    text: card("🌊 <b>ضد فلوود و اسپم</b>", [
      `وضعیت: ${on(settings.antispam_enabled)}`,
      `حد پیام: <b>${faNum(settings.flood_limit)}</b> پیام`,
      `بازهٔ زمانی: <b>${faNum(settings.flood_window_seconds)}</b> ثانیه`,
      "",
      "اگر عضوی در این بازه بیشتر از حد پیام بفرستد، پیام‌های اضافه حذف و اخطار ثبت می‌شود.",
    ]),
    markup: kb([
      [
        btn("➖ حد", "p:fls:l:-"),
        btn(`${faNum(settings.flood_limit)} پیام`, "p:fl"),
        btn("➕ حد", "p:fls:l:+"),
      ],
      [
        btn("➖ بازه", "p:fls:w:-"),
        btn(`${faNum(settings.flood_window_seconds)} ثانیه`, "p:fl"),
        btn("➕ بازه", "p:fls:w:+"),
      ],
      backRow(),
    ]),
  };
}

function purgeView(deleted?: number): { text: string; markup: Markup } {
  return {
    text: card("🧹 <b>پاک‌سازی گروه</b>", [
      deleted === undefined ? "چند پیام آخر گروه پاک شود؟" : `✅ ${faNum(deleted)} پیام پاک شد.`,
      "پیام‌ها از همین پیام پنل به عقب حذف می‌شوند.",
      "<i>تلگرام حذف پیام‌های قدیمی‌تر از ۴۸ ساعت را اجازه نمی‌دهد.</i>",
    ]),
    markup: kb([
      [btn("🗑 ۱۰ پیام", "p:pgd:10"), btn("🗑 ۵۰ پیام", "p:pgd:50")],
      [btn("🗑 ۱۰۰ پیام", "p:pgd:100")],
      backRow(),
    ]),
  };
}

export const HELP_TEXT = card("🤖 <b>راهنمای دستورها</b>", [
  "🔐 <code>قفل لینک</code> · <code>بازکردن لینک</code> · <code>قفل ها</code> — ۳۷ قفل",
  "🚫 <code>بن</code> · <code>رفع مسدودیت</code> · <code>سکوت</code> · <code>لغو سکوت</code>",
  "⚠️ <code>اخطار</code> · <code>کسر اخطار</code> · <code>تعداد اخطار ۴</code>",
  "👮 <code>افزودن مدیر</code> · <code>عزل مدیر</code> · <code>لیست کاربران مدیر</code>",
  "⭐ <code>افزودن ویژه</code> · <code>عزل ویژه</code> · <code>مثبت</code> · <code>امتیاز</code>",
  "🔤 <code>فیلتر کردن کلمه</code> · <code>حذف فیلتر کلمه</code> · <code>لیست فیلتر</code>",
  "🧹 <code>حذف ۵۰</code> · 👋 <code>خوشامد</code> · <code>خوشامد متن …</code>",
  "📜 <code>قوانین</code> · 🆔 <code>آیدی</code> · 📢 <code>پنل</code>",
]);

export function privateHome(cfg: Cfg, userId: number): { text: string; markup: Markup } {
  const owner = cfg.superAdmins.includes(userId);
  const rows = [];
  if (owner) rows.push([btn("👑 پنل مالک", "p:o")]);
  rows.push([btn("ℹ️ راهنما", "p:help"), btn("📜 قوانین", "p:rules")]);
  rows.push([urlBtn("➕ افزودن به گروه", `https://t.me/${cfg.botUsername}?startgroup=true`)]);
  return {
    text: card("🤖 <b>اسپیکسل</b>", [
      "دستیار و مدیر گروه، به سبک دیجی‌انتی.",
      "",
      "• در گروه بنویس <code>پنل</code> تا پنل مدیریت باز شود",
      "• در گروه بنویس <code>قفل لینک</code> تا قفل روشن شود",
      "• <code>راهنما</code> همهٔ دستورها را نشان می‌دهد",
      owner ? "• <code>/owner</code> — پنل مالک ربات" : "",
      "",
      "دکمه‌های زیر را بزن.",
    ]),
    markup: kb(rows),
  };
}

export async function ownerView(cfg: Cfg): Promise<{ text: string; markup: Markup }> {
  const [users, groups, blocked, words] = await Promise.all([
    dbCount(cfg, "users"),
    dbCount(cfg, "groups", "is_active=eq.true"),
    dbCount(cfg, "banned_users", "is_active=eq.true"),
    dbCount(cfg, "group_words"),
  ]);
  return {
    text: card("👑 <b>پنل مالک اسپیکسل</b>", [
      `شناسهٔ مالک: <code>${faNum(cfg.superAdmins[0] ?? 0)}</code>`,
      `👥 کاربران: <b>${faNum(users)}</b> · 👮 گروه‌های فعال: <b>${faNum(groups)}</b>`,
      `🚫 مسدود در ربات: <b>${faNum(blocked)}</b> · 🔤 کلمات فیلتر: <b>${faNum(words)}</b>`,
      "",
      "برای پیام همگانی بنویس: <code>/broadcast متن پیام</code>",
    ]),
    markup: kb([
      [btn("🔄 به‌روزرسانی", "p:o"), btn("📊 آمار ربات", "p:ostats")],
      [btn("📋 راهنما", "p:help")],
      [btn("↩️ بازگشت", "p:home")],
    ]),
  };
}

// ─── هندلر کال‌بک ────────────────────────────────────────────────────────────

export async function handlePanelCallback(cfg: Cfg, cq: TgCallback): Promise<boolean> {
  const data = cq.data ?? "";
  if (!data.startsWith("p:")) return false;

  const parts = data.split(":");
  const action = parts[1] ?? "";
  const chat = cq.message?.chat;
  const messageId = cq.message?.message_id;
  const isGroup = chat?.type === "group" || chat?.type === "supergroup";
  const chatId = chat?.id ?? cq.from.id;

  const show = async (view: { text: string; markup: Markup }) => {
    if (chat && messageId && await editMessage(cfg, chat.id, messageId, view.text, view.markup)) {
      return;
    }
    await sendMessage(cfg, chatId, view.text, { markup: view.markup });
  };
  const say = (text: string, alert = false) => answerCallback(cfg, cq.id, text, alert);

  if (action === "q") {
    if (chat && messageId) await deleteMessage(cfg, chat.id, messageId);
    return true;
  }
  if (action === "help") {
    await show({ text: HELP_TEXT, markup: kb([backRow(isGroup ? "p:m" : "p:home")]) });
    return true;
  }
  if (action === "home") {
    await show(privateHome(cfg, cq.from.id));
    return true;
  }
  if (action === "o") {
    if (!cfg.superAdmins.includes(cq.from.id)) {
      await say("⛔ فقط مالک ربات.", true);
      return true;
    }
    await show(await ownerView(cfg));
    return true;
  }
  if (action === "ostats") {
    if (!cfg.superAdmins.includes(cq.from.id)) {
      await say("⛔ فقط مالک ربات.", true);
      return true;
    }
    const [users, groups, warnings, bans, sessions] = await Promise.all([
      dbCount(cfg, "users"),
      dbCount(cfg, "groups"),
      dbCount(cfg, "user_warnings", "is_active=eq.true"),
      dbCount(cfg, "group_bans", "is_active=eq.true"),
      dbCount(cfg, "moderation_logs"),
    ]);
    await show({
      text: card("📊 <b>آمار ربات</b>", [
        `👥 کاربران: <b>${faNum(users)}</b>`,
        `👮 گروه‌ها: <b>${faNum(groups)}</b>`,
        `⚠️ اخطار فعال: <b>${faNum(warnings)}</b>`,
        `🚫 بن/سکوت: <b>${faNum(bans)}</b>`,
        `📝 رخداد مدیریتی: <b>${faNum(sessions)}</b>`,
      ]),
      markup: kb([[btn("🔄", "p:ostats"), btn("↩️", "p:o")]]),
    });
    return true;
  }
  if (action === "grp") {
    await say(
      `از دکمهٔ «افزودن به گروه» یا لینک t.me/${cfg.botUsername}?startgroup=true استفاده کن.`,
      true,
    );
    return true;
  }
  if (action === "rules") {
    const settings = isGroup && chat ? await loadSettings(cfg, chat) : null;
    const body = settings?.rules_text?.trim() || "قوانینی ثبت نشده است.";
    await show({
      text: card("📜 <b>قوانین گروه</b>", [esc(body)]),
      markup: kb([backRow(isGroup ? "p:m" : "p:home")]),
    });
    return true;
  }

  if (action === "verify") {
    const expected = Number(parts[2]);
    if (!chat || !Number.isSafeInteger(expected) || expected !== cq.from.id) {
      await say("این دکمه برای شما نیست.", true);
      return true;
    }
    await unbanMember(cfg, chat.id, cq.from.id);
    try {
      await tg(cfg, "restrictChatMember", {
        chat_id: chat.id,
        user_id: cq.from.id,
        permissions: ALL_PERMISSIONS,
      });
    } catch {
      // دسترسی ربات کافی نیست
    }
    if (messageId) {
      await editMessage(
        cfg,
        chat.id,
        messageId,
        card("✅ <b>تأیید شد</b>", [`${mention(cq.from)} عزیز، خوش آمدی!`]),
      );
    }
    await say("✅ تأیید شد");
    return true;
  }

  if (!isGroup || !chat) {
    await say("این بخش فقط در گروه کار می‌کند.", true);
    return true;
  }
  if (!(await isGroupAdmin(cfg, chatId, cq.from.id))) {
    await say("⛔ فقط مدیران گروه.", true);
    return true;
  }

  const settings = await loadSettings(cfg, chat);

  if (action === "m") {
    await show({ text: mainScreen(settings), markup: mainMarkup(true) });
    return true;
  }
  if (action === "l") {
    await show(locksView(settings, Number(parts[2] ?? 0) || 0));
    return true;
  }
  if (action === "t") {
    const key = parts[2] ?? "";
    const page = Number(parts[3] ?? 0) || 0;
    const def = LOCK_DEFS.find((item) => item.key === key);
    if (!def) {
      await say("این قفل شناخته نشد.", true);
      return true;
    }
    const locks = normalizeLocks(settings.locks);
    const enable = !locks[key];
    if (enable) locks[key] = true;
    else delete locks[key];
    await saveSettings(cfg, chatId, { locks });
    if (hasPermissionLocks(locks)) {
      await setPermissions(cfg, chatId, buildPermissions(locks));
    }
    await say(`${def.emoji} ${def.label}: ${enable ? "قفل شد" : "باز شد"}`);
    await show(locksView({ ...settings, locks }, page));
    return true;
  }
  if (action === "all") {
    const enable = parts[2] === "on";
    const locks: Record<string, boolean> = {};
    if (enable) { for (const def of LOCK_DEFS) locks[def.key] = true; }
    await saveSettings(cfg, chatId, { locks });
    await setPermissions(cfg, chatId, buildPermissions(locks));
    await say(enable ? "همهٔ قفل‌ها بسته شد" : "همهٔ قفل‌ها باز شد");
    await show(locksView({ ...settings, locks }, 0));
    return true;
  }
  if (action === "a") {
    await show(automationView(settings));
    return true;
  }
  if (action === "x") {
    const field = parts[2] as keyof Settings | undefined;
    const allowed: (keyof Settings)[] = [
      "antilink_enabled",
      "antispam_enabled",
      "block_forwards",
      "welcome_enabled",
      "verify_enabled",
      "strict_mode",
      "delete_warn_messages",
    ];
    if (!field || !allowed.includes(field)) {
      await say("این گزینه شناخته نشد.", true);
      return true;
    }
    const value = settings[field] !== true;
    await saveSettings(cfg, chatId, { [field]: value } as Partial<Settings>);
    await say(value ? "روشن شد" : "خاموش شد");
    await show(automationView({ ...settings, [field]: value } as Settings));
    return true;
  }
  if (action === "pun") {
    await show(punishView(settings));
    return true;
  }
  if (action === "warn") {
    const limit = Math.max(1, Math.min(10, settings.warn_limit + (parts[2] === "+" ? 1 : -1)));
    await saveSettings(cfg, chatId, { warn_limit: limit });
    await show(punishView({ ...settings, warn_limit: limit }));
    return true;
  }
  if (action === "act") {
    const next = parts[2];
    const value = next === "kick" || next === "ban" ? next : "mute";
    await saveSettings(cfg, chatId, { warn_action: value });
    await show(punishView({ ...settings, warn_action: value }));
    return true;
  }
  if (action === "mute") {
    const minutes = step(MUTE_STEPS, settings.mute_duration_minutes, parts[2] === "+" ? 1 : -1);
    await saveSettings(cfg, chatId, { mute_duration_minutes: minutes });
    await show(punishView({ ...settings, mute_duration_minutes: minutes }));
    return true;
  }
  if (action === "s") {
    await show(staffView(await listStaff(cfg, chatId)));
    return true;
  }
  if (action === "f") {
    await show(await filterView(cfg, chatId));
    return true;
  }
  if (action === "fr") {
    const id = Number(parts[2]);
    if (!Number.isSafeInteger(id)) {
      await say("این دکمه معتبر نیست.", true);
      return true;
    }
    await removeWord(cfg, chatId, id);
    await say("کلمه حذف شد");
    await show(await filterView(cfg, chatId));
    return true;
  }
  if (action === "st") {
    await show(await statsView(cfg, chatId, settings));
    return true;
  }
  if (action === "wl") {
    await show(welcomeView(settings));
    return true;
  }
  if (action === "wg") {
    const enabled = !settings.welcome_enabled;
    await saveSettings(cfg, chatId, { welcome_enabled: enabled });
    await say(enabled ? "خوش‌آمد روشن شد" : "خوش‌آمد خاموش شد");
    await show(welcomeView({ ...settings, welcome_enabled: enabled }));
    return true;
  }
  if (action === "wt") {
    const template = WELCOME_TEMPLATES[Number(parts[2])];
    if (!template) {
      await say("این قالب شناخته نشد.", true);
      return true;
    }
    await saveSettings(cfg, chatId, { welcome_text: template.text });
    await say(`قالب «${template.label}» ثبت شد.`);
    await show(welcomeView({ ...settings, welcome_text: template.text }));
    return true;
  }
  if (action === "fl") {
    await show(floodView(settings));
    return true;
  }
  if (action === "fls") {
    const isWindow = parts[2] === "w";
    const delta = parts[3] === "+" ? 1 : -1;
    const value = isWindow
      ? step(FLOOD_WINDOWS, settings.flood_window_seconds, delta)
      : step(FLOOD_LIMITS, settings.flood_limit, delta);
    const patch = isWindow ? { flood_window_seconds: value } : { flood_limit: value };
    await saveSettings(cfg, chatId, patch);
    await say(isWindow ? `⏱ ${faNum(value)} ثانیه` : `🌊 ${faNum(value)} پیام`);
    await show(floodView({ ...settings, ...patch }));
    return true;
  }
  if (action === "pg") {
    await show(purgeView());
    return true;
  }
  if (action === "pgd") {
    const requested = Math.max(1, Math.min(100, Number(parts[2]) || 10));
    let deleted = 0;
    if (messageId) {
      for (let offset = 1; offset <= requested; offset++) {
        if (await deleteMessage(cfg, chatId, messageId - offset)) deleted++;
      }
    }
    await say(`🧹 ${faNum(deleted)} پیام پاک شد`);
    await show(purgeView(deleted));
    return true;
  }

  await say("این دکمه پشتیبانی نمی‌شود.", true);
  return true;
}

/** دستورهای متنی کال‌بک‌مانند (برای میان‌برهای پنل). */
export async function toggleLockByText(
  cfg: Cfg,
  message: TgMessage,
  name: string,
  enable: boolean,
): Promise<boolean> {
  const key = lockKey(name);
  if (!key) return false;
  const settings = await loadSettings(cfg, message.chat);
  const locks = normalizeLocks(settings.locks);
  if (enable) locks[key] = true;
  else delete locks[key];
  await saveSettings(cfg, message.chat.id, { locks });
  if (hasPermissionLocks(locks)) {
    await setPermissions(cfg, message.chat.id, buildPermissions(locks));
  }
  return true;
}
