/**
 * هستهٔ اسپیکسل — پیکربندی، کلاینت تلگرام، کلاینت Supabase و رندر کارت‌ها.
 * این نسخه از صفر نوشته شده و هیچ وابستگی خارجی (npm/jsr) ندارد.
 */

export const BUILD = "spixle-2026-11-26";

export interface Cfg {
  supabaseUrl: string;
  serviceKey: string;
  botToken: string;
  webhookSecret: string;
  superAdmins: number[];
  botUsername: string;
}

type Env = Record<string, string | undefined>;

export function env(): Env {
  const deno = (globalThis as { Deno?: { env?: { toObject(): Record<string, string> } } }).Deno;
  return deno?.env?.toObject() ?? {};
}

function adminIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw.split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function loadCfg(source: Env = env()): Cfg {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN"]
    .filter((key) => !source[key]?.trim());
  if (missing.length > 0) throw new Error(`تنظیمات ناقص: ${missing.join(", ")}`);
  return {
    supabaseUrl: source.SUPABASE_URL!.trim().replace(/\/$/, ""),
    serviceKey: source.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    botToken: source.TELEGRAM_BOT_TOKEN!.trim(),
    webhookSecret: source.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "",
    superAdmins: adminIds(source.SUPER_ADMIN_IDS),
    botUsername: (source.BOT_USERNAME?.trim() || "Spixle_bot").replace(/^@/, ""),
  };
}

// ─── تلگرام ──────────────────────────────────────────────────────────────────

export class TgError extends Error {
  readonly code: number;
  readonly description: string;

  constructor(code: number, description: string) {
    super(`Telegram ${code}: ${description}`);
    this.name = "TgError";
    this.code = code;
    this.description = description;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Envelope<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

export async function tg<T = unknown>(
  cfg: Cfg,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const url = `https://api.telegram.org/bot${cfg.botToken}/${method}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({})) as Envelope<T>;
    if (body.ok) return body.result as T;
    const code = body.error_code ?? res.status;
    if (code === 429) {
      await sleep(Math.min((body.parameters?.retry_after ?? 1) * 1000, 5000));
      continue;
    }
    throw new TgError(code, body.description ?? "unknown error");
  }
  throw new TgError(429, "too many requests");
}

export type Markup = { inline_keyboard: Btn[][] };

export type Btn = {
  text: string;
  callback_data?: string;
  url?: string;
};

export function btn(text: string, data: string): Btn {
  return { text, callback_data: data };
}

export function urlBtn(text: string, url: string): Btn {
  return { text, url };
}

export function kb(rows: Btn[][]): Markup {
  return { inline_keyboard: rows.filter((row) => row.length > 0) };
}

export type SendOpts = { markup?: Markup; preview?: boolean; replyTo?: number };

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  entities?: { type: string; offset: number; length: number }[];
  caption_entities?: { type: string; offset: number; length: number }[];
  reply_to_message?: TgMessage;
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
  photo?: unknown[];
  video?: unknown;
  animation?: unknown;
  sticker?: unknown;
  voice?: unknown;
  audio?: unknown;
  document?: unknown;
  video_note?: unknown;
  poll?: unknown;
  dice?: unknown;
  location?: unknown;
  venue?: unknown;
  game?: unknown;
  via_bot?: TgUser;
  forward_origin?: unknown;
  forward_date?: number;
  is_automatic_forward?: boolean;
  edit_date?: number;
  reply_markup?: Markup;
  pinned_message?: unknown;
}

export interface TgCallback {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallback;
  my_chat_member?: { chat: TgChat; from: TgUser; new_chat_member: { status: string } };
}

export async function sendMessage(
  cfg: Cfg,
  chatId: number,
  text: string,
  opts: SendOpts = {},
): Promise<TgMessage | null> {
  try {
    return await tg<TgMessage>(cfg, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: opts.preview !== true,
      reply_to_message_id: opts.replyTo,
      reply_markup: opts.markup,
    });
  } catch {
    return null;
  }
}

export async function editMessage(
  cfg: Cfg,
  chatId: number,
  messageId: number,
  text: string,
  markup?: Markup,
): Promise<boolean> {
  try {
    await tg(cfg, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: markup,
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteMessage(cfg: Cfg, chatId: number, messageId: number): Promise<boolean> {
  try {
    await tg(cfg, "deleteMessage", { chat_id: chatId, message_id: messageId });
    return true;
  } catch {
    return false;
  }
}

export async function answerCallback(
  cfg: Cfg,
  id: string,
  text: string,
  alert = false,
): Promise<void> {
  try {
    await tg(cfg, "answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });
  } catch {
    // کال‌بک منقضی شده
  }
}

export interface ChatMember {
  status: string;
  user: TgUser;
  can_delete_messages?: boolean;
  can_restrict_members?: boolean;
}

export async function getChatMember(
  cfg: Cfg,
  chatId: number,
  userId: number,
): Promise<ChatMember | null> {
  try {
    return await tg<ChatMember>(cfg, "getChatMember", { chat_id: chatId, user_id: userId });
  } catch {
    return null;
  }
}

export async function restrictMember(
  cfg: Cfg,
  chatId: number,
  userId: number,
  until: number,
): Promise<boolean> {
  try {
    await tg(cfg, "restrictChatMember", {
      chat_id: chatId,
      user_id: userId,
      permissions: {},
      until_date: until,
    });
    return true;
  } catch {
    return false;
  }
}

export async function kickMember(cfg: Cfg, chatId: number, userId: number): Promise<boolean> {
  try {
    await tg(cfg, "banChatMember", { chat_id: chatId, user_id: userId });
    await tg(cfg, "unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
    return true;
  } catch {
    return false;
  }
}

export async function banMember(cfg: Cfg, chatId: number, userId: number): Promise<boolean> {
  try {
    await tg(cfg, "banChatMember", { chat_id: chatId, user_id: userId });
    return true;
  } catch {
    return false;
  }
}

export async function unbanMember(cfg: Cfg, chatId: number, userId: number): Promise<boolean> {
  try {
    await tg(cfg, "unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
    return true;
  } catch {
    return false;
  }
}

export async function setPermissions(
  cfg: Cfg,
  chatId: number,
  permissions: Record<string, boolean>,
): Promise<boolean> {
  try {
    await tg(cfg, "setChatPermissions", { chat_id: chatId, permissions });
    return true;
  } catch {
    return false;
  }
}

// ─── Supabase (PostgREST) ────────────────────────────────────────────────────

async function dbFetch(
  cfg: Cfg,
  path: string,
  init: RequestInit = {},
  prefer?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: cfg.serviceKey,
    authorization: `Bearer ${cfg.serviceKey}`,
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (prefer) headers.prefer = prefer;
  return await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, { ...init, headers });
}

export async function dbSelect<T>(
  cfg: Cfg,
  table: string,
  query = "",
): Promise<T[]> {
  try {
    const res = await dbFetch(cfg, `${table}${query ? `?${query}` : ""}`);
    if (!res.ok) return [];
    return await res.json() as T[];
  } catch {
    return [];
  }
}

export async function dbInsert<T>(cfg: Cfg, table: string, rows: unknown): Promise<T[]> {
  try {
    const res = await dbFetch(cfg, table, {
      method: "POST",
      body: JSON.stringify(rows),
    }, "return=representation");
    if (!res.ok) return [];
    return await res.json() as T[];
  } catch {
    return [];
  }
}

export async function dbUpsert(cfg: Cfg, table: string, rows: unknown): Promise<boolean> {
  try {
    const res = await dbFetch(cfg, table, {
      method: "POST",
      body: JSON.stringify(rows),
    }, "resolution=merge-duplicates,return=minimal");
    return res.ok;
  } catch {
    return false;
  }
}

export async function dbPatch(
  cfg: Cfg,
  table: string,
  query: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await dbFetch(cfg, `${table}?${query}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }, "return=minimal");
    return res.ok;
  } catch {
    return false;
  }
}

export async function dbDelete(cfg: Cfg, table: string, query: string): Promise<boolean> {
  try {
    const res = await dbFetch(cfg, `${table}?${query}`, { method: "DELETE" }, "return=minimal");
    return res.ok;
  } catch {
    return false;
  }
}

export async function dbCount(cfg: Cfg, table: string, query = ""): Promise<number> {
  try {
    const res = await dbFetch(cfg, `${table}${query ? `?${query}` : ""}`, {
      method: "HEAD",
    }, "count=exact");
    const range = res.headers.get("content-range") ?? "";
    const total = Number(range.split("/")[1]);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

// ─── متن و رندر ─────────────────────────────────────────────────────────────

const DIVIDER = "─━┅┅┈ ✁ ┈┅┅━─";
const FOOTER = "━━ 🆂🅿🅸🆇🅻🅴 ━━";

/** ظاهر همهٔ کارت‌ها، عین استایل دیجی‌انتی. */
export function card(title: string, lines: string[]): string {
  return [title, DIVIDER, ...lines, DIVIDER, FOOTER].filter((line) => line !== undefined).join(
    "\n",
  );
}

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function faNum(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

export function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

/** نرمال‌سازی متن فارسی برای مقایسهٔ دستورها. */
export function normalize(value: string): string {
  return normalizeDigits(value)
    .replace(/[‌‎‏]/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[.!؟?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function displayName(user: TgUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "کاربر";
}

export function mention(user: TgUser): string {
  return `<a href="tg://user?id=${user.id}">${esc(displayName(user))}</a>`;
}

/** کاربر هدف از ریپلای. */
export function targetOf(message: TgMessage): number | null {
  const reply = message.reply_to_message?.from;
  if (!reply || reply.is_bot) return null;
  return reply.id;
}

export function on(value: boolean): string {
  return value ? "🟢" : "🔴";
}
