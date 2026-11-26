/**
 * ذخیره‌سازی — تنظیمات گروه، مدیران/ویژه‌ها، فیلتر کلمات، اخطار، مجازات و امتیاز.
 * همه از طریق REST خود Supabase (بدون ابزار اضافی).
 */
import {
  banMember,
  type Cfg,
  dbCount,
  dbDelete,
  dbInsert,
  dbPatch,
  dbSelect,
  dbUpsert,
  esc,
  faNum,
  getChatMember,
  kickMember,
  restrictMember,
  type TgChat,
  type TgUser,
} from "./core.ts";

export interface Settings {
  group_id: number;
  welcome_enabled: boolean;
  welcome_text: string;
  goodbye_enabled: boolean;
  goodbye_text: string;
  rules_text: string;
  antilink_enabled: boolean;
  antispam_enabled: boolean;
  block_forwards: boolean;
  delete_warn_messages: boolean;
  verify_enabled: boolean;
  strict_mode: boolean;
  locks: Record<string, boolean>;
  flood_limit: number;
  flood_window_seconds: number;
  warn_limit: number;
  warn_action: "mute" | "kick" | "ban";
  mute_duration_minutes: number;
  language: "fa" | "en";
}

export const DEFAULT_RULES =
  "۱. احترام به همه اعضا الزامی است.\n۲. تبلیغ و لینک ناخواسته ممنوع است.\n۳. اسپم و ارسال پیام تکراری ممنوع است.";

export function defaults(groupId: number): Settings {
  return {
    group_id: groupId,
    welcome_enabled: true,
    welcome_text: "👋 {name} عزیز به {group} خوش آمدی!",
    goodbye_enabled: false,
    goodbye_text: "👋 {name} از {group} خارج شد.",
    rules_text: DEFAULT_RULES,
    antilink_enabled: true,
    antispam_enabled: true,
    block_forwards: false,
    delete_warn_messages: true,
    verify_enabled: false,
    strict_mode: false,
    locks: {},
    flood_limit: 6,
    flood_window_seconds: 20,
    warn_limit: 3,
    warn_action: "mute",
    mute_duration_minutes: 60,
    language: "fa",
  };
}

const cache = new Map<number, { at: number; value: Settings }>();
const CACHE_MS = 15_000;

function chatType(chat: TgChat): "group" | "supergroup" | "channel" {
  if (chat.type === "channel") return "channel";
  return chat.type === "supergroup" ? "supergroup" : "group";
}

async function ensureGroup(cfg: Cfg, chat: TgChat): Promise<void> {
  await dbUpsert(cfg, "groups?on_conflict=telegram_chat_id", {
    telegram_chat_id: chat.id,
    title: chat.title ?? null,
    username: chat.username ?? null,
    type: chatType(chat),
    is_active: true,
    left_at: null,
  });
}

/** تنظیمات گروه را می‌خواند یا می‌سازد؛ اگر DB در دسترس نبود پیش‌فرض برمی‌گردد. */
export async function loadSettings(cfg: Cfg, chat: TgChat): Promise<Settings> {
  const cached = cache.get(chat.id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  await ensureGroup(cfg, chat);
  const rows = await dbSelect<Partial<Settings>>(
    cfg,
    "group_settings",
    `group_id=eq.${chat.id}&select=*&limit=1`,
  );
  let value: Settings;
  if (rows.length > 0) {
    value = { ...defaults(chat.id), ...rows[0] } as Settings;
    value.locks = (rows[0].locks ?? {}) as Record<string, boolean>;
  } else {
    value = defaults(chat.id);
    await dbInsert(cfg, "group_settings", {
      group_id: chat.id,
      welcome_text: value.welcome_text,
      goodbye_text: value.goodbye_text,
      rules_text: value.rules_text,
    });
  }
  cache.set(chat.id, { at: Date.now(), value });
  return value;
}

export async function saveSettings(
  cfg: Cfg,
  groupId: number,
  patch: Partial<Settings>,
): Promise<boolean> {
  cache.delete(groupId);
  const ok = await dbPatch(cfg, "group_settings", `group_id=eq.${groupId}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
  return ok;
}

export function forgetSettings(groupId: number): void {
  cache.delete(groupId);
}

// ─── دسترسی ─────────────────────────────────────────────────────────────────

export async function isGroupAdmin(
  cfg: Cfg,
  chatId: number,
  userId: number,
): Promise<boolean> {
  if (cfg.superAdmins.includes(userId)) return true;
  const member = await getChatMember(cfg, chatId, userId);
  if (member && (member.status === "creator" || member.status === "administrator")) return true;
  const staff = await dbSelect<{ id: number }>(
    cfg,
    "group_staff",
    `group_id=eq.${chatId}&user_id=eq.${userId}&role=eq.admin&select=id&limit=1`,
  );
  return staff.length > 0;
}

export async function isVip(cfg: Cfg, chatId: number, userId: number): Promise<boolean> {
  const rows = await dbSelect<{ id: number }>(
    cfg,
    "group_staff",
    `group_id=eq.${chatId}&user_id=eq.${userId}&role=eq.vip&select=id&limit=1`,
  );
  return rows.length > 0;
}

export interface StaffRow {
  user_id: number;
  role: "admin" | "vip";
  created_at: string;
}

export async function listStaff(cfg: Cfg, chatId: number): Promise<StaffRow[]> {
  return await dbSelect<StaffRow>(
    cfg,
    "group_staff",
    `group_id=eq.${chatId}&select=user_id,role,created_at&order=created_at.asc&limit=50`,
  );
}

export async function addStaff(
  cfg: Cfg,
  chatId: number,
  userId: number,
  role: "admin" | "vip",
  by: number,
): Promise<boolean> {
  await dbUpsert(cfg, "group_staff?on_conflict=group_id,user_id,role", {
    group_id: chatId,
    user_id: userId,
    role,
    added_by: by,
  });
  return true;
}

export async function removeStaff(
  cfg: Cfg,
  chatId: number,
  userId: number,
  role: "admin" | "vip",
): Promise<boolean> {
  return await dbDelete(
    cfg,
    "group_staff",
    `group_id=eq.${chatId}&user_id=eq.${userId}&role=eq.${role}`,
  );
}

// ─── فیلتر کلمات ─────────────────────────────────────────────────────────────

const wordCache = new Map<number, { at: number; words: string[] }>();
const WORD_MS = 30_000;

export async function bannedWords(cfg: Cfg, chatId: number): Promise<string[]> {
  const cached = wordCache.get(chatId);
  if (cached && Date.now() - cached.at < WORD_MS) return cached.words;
  const rows = await dbSelect<{ word: string }>(
    cfg,
    "group_words",
    `group_id=eq.${chatId}&select=word&limit=500`,
  );
  const words = rows.map((row) => row.word.toLowerCase()).filter(Boolean);
  wordCache.set(chatId, { at: Date.now(), words });
  return words;
}

export function forgetWords(chatId: number): void {
  wordCache.delete(chatId);
}

export interface WordRow {
  id: number;
  word: string;
}

export async function listWords(cfg: Cfg, chatId: number): Promise<WordRow[]> {
  return await dbSelect<WordRow>(
    cfg,
    "group_words",
    `group_id=eq.${chatId}&select=id,word&order=created_at.desc&limit=30`,
  );
}

export async function addWord(
  cfg: Cfg,
  chatId: number,
  word: string,
  by: number,
): Promise<boolean> {
  forgetWords(chatId);
  const rows = await dbInsert(cfg, "group_words", {
    group_id: chatId,
    word: word.trim(),
    created_by: by,
  });
  return rows.length > 0;
}

export async function removeWord(cfg: Cfg, chatId: number, id: number): Promise<boolean> {
  forgetWords(chatId);
  return await dbDelete(cfg, "group_words", `id=eq.${id}&group_id=eq.${chatId}`);
}

// ─── اخطار و مجازات ─────────────────────────────────────────────────────────

export async function warnCount(cfg: Cfg, chatId: number, userId: number): Promise<number> {
  return await dbCount(
    cfg,
    "user_warnings",
    `group_id=eq.${chatId}&user_id=eq.${userId}&is_active=eq.true`,
  );
}

export async function addWarning(
  cfg: Cfg,
  chatId: number,
  userId: number,
  reason: string,
  by: number,
): Promise<number> {
  await dbInsert(cfg, "user_warnings", {
    group_id: chatId,
    user_id: userId,
    warned_by: by,
    reason: reason.slice(0, 200),
  });
  return await warnCount(cfg, chatId, userId);
}

export async function clearWarnings(
  cfg: Cfg,
  chatId: number,
  userId: number,
): Promise<boolean> {
  return await dbPatch(
    cfg,
    "user_warnings",
    `group_id=eq.${chatId}&user_id=eq.${userId}&is_active=eq.true`,
    { is_active: false, revoked_at: new Date().toISOString() },
  );
}

/** مجازات را اعمال می‌کند و متن نتیجه را برمی‌گرداند. */
export async function punish(
  cfg: Cfg,
  chatId: number,
  userId: number,
  settings: Settings,
): Promise<string> {
  if (settings.warn_action === "ban") {
    return (await banMember(cfg, chatId, userId)) ? "بن شد 🚫" : "بن انجام نشد";
  }
  if (settings.warn_action === "kick") {
    return (await kickMember(cfg, chatId, userId)) ? "اخراج شد 👢" : "اخراج انجام نشد";
  }
  const until = Math.floor(Date.now() / 1000) + settings.mute_duration_minutes * 60;
  return (await restrictMember(cfg, chatId, userId, until))
    ? `برای ${faNum(settings.mute_duration_minutes)} دقیقه سکوت شد 🔇`
    : "سکوت انجام نشد";
}

// ─── امتیاز و حضور کاربر ────────────────────────────────────────────────────

export async function scoreOf(cfg: Cfg, chatId: number, userId: number): Promise<number> {
  const rows = await dbSelect<{ score: number }>(
    cfg,
    "group_scores",
    `group_id=eq.${chatId}&user_id=eq.${userId}&select=score&limit=1`,
  );
  return Number(rows[0]?.score ?? 0);
}

export async function bumpScore(
  cfg: Cfg,
  chatId: number,
  userId: number,
  delta: number,
): Promise<number> {
  const score = (await scoreOf(cfg, chatId, userId)) + delta;
  await dbUpsert(cfg, "group_scores?on_conflict=group_id,user_id", {
    group_id: chatId,
    user_id: userId,
    score,
    updated_at: new Date().toISOString(),
  });
  return score;
}

export async function rememberUser(cfg: Cfg, user: TgUser): Promise<void> {
  if (user.is_bot) return;
  await dbUpsert(cfg, "users?on_conflict=telegram_id", {
    telegram_id: user.id,
    username: user.username ?? null,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    last_seen_at: new Date().toISOString(),
  });
}

// ─── خوش‌آمد ────────────────────────────────────────────────────────────────

const PAD = (value: number) => String(value).padStart(2, "0");

export interface WelcomeCtx {
  chatId: number;
  groupTitle: string;
  botUsername: string;
  timeZone: string;
}

/** قالب خوش‌آمد/خداحافظی با متغیرهای دیجی‌انتی. */
export function renderTemplate(template: string, user: TgUser, ctx: WelcomeCtx): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("fa-IR", {
    timeZone: ctx.timeZone,
    dateStyle: "full",
  }).formatToParts(now);
  const date = parts.filter((part) => part.type !== "literal").map((part) => part.value).join("");
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ") || "دوست عزیز";
  const values: Record<string, string> = {
    name: `<a href="tg://user?id=${user.id}">${esc(full)}</a>`,
    NAME: `<a href="tg://user?id=${user.id}">${esc(full)}</a>`,
    username: user.username ? `@${user.username}` : esc(full),
    USERNAME: user.username ? `@${user.username}` : esc(full),
    group: esc(ctx.groupTitle),
    GROUP: esc(ctx.groupTitle),
    TIME: `${PAD(now.getHours())}:${PAD(now.getMinutes())}`,
    DATE: date,
    USERID: String(user.id),
    CHATID: String(ctx.chatId),
    FIRST_NAME: esc(user.first_name ?? ""),
    LAST_NAME: esc(user.last_name ?? ""),
    BOTUSER: `@${ctx.botUsername}`,
  };
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return output;
}
