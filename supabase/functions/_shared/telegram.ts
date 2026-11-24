/**
 * Telegram Bot API client — بدون وابستگی خارجی، با مدیریت 429/5xx.
 * توکن هرگز در پیام خطا یا لاگ قرار نمی‌گیرد.
 */
import { fetchJson, HttpError, sleep } from "./http.ts";
import type {
  ChatId,
  MediaType,
  TgChatFullInfo,
  TgChatMember,
  TgInlineKeyboardButton,
  TgInlineKeyboardMarkup,
  TgMessage,
  TgUser,
} from "./types.ts";

export interface TelegramApiOptions {
  apiBase?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class TelegramError extends Error {
  readonly code: number;
  readonly description: string;
  readonly retryAfter: number | undefined;

  constructor(code: number, description: string, retryAfter?: number) {
    super(`Telegram API error ${code}: ${description}`);
    this.name = "TelegramError";
    this.code = code;
    this.description = description;
    this.retryAfter = retryAfter;
  }

  get isRateLimited(): boolean {
    return this.code === 429;
  }

  get isForbidden(): boolean {
    return this.code === 403;
  }

  get isChatNotFound(): boolean {
    return this.code === 400 && /chat not found|chat_id is empty/i.test(this.description);
  }

  get isNotModified(): boolean {
    return this.description.includes("message is not modified");
  }

  /** کاربر ربات را بلاک/حذف کرده یا حساب حذف شده است. */
  get isUserUnreachable(): boolean {
    return (
      this.code === 403 ||
      /bot was blocked|user is deactivated|chat not found|peer_id_invalid|bot can't initiate/i.test(
        this.description,
      )
    );
  }
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export interface SendMessageExtra {
  markup?: TgInlineKeyboardMarkup;
  preview?: boolean;
  replyTo?: number;
  silent?: boolean;
}

export interface SendMediaExtra {
  markup?: TgInlineKeyboardMarkup;
  caption?: string;
  silent?: boolean;
}

const MEDIA_METHOD: Record<Exclude<MediaType, "none">, string> = {
  photo: "sendPhoto",
  video: "sendVideo",
  animation: "sendAnimation",
  document: "sendDocument",
};

export const MUTED_PERMISSIONS: Record<string, boolean> = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

export const FULL_PERMISSIONS: Record<string, boolean> = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_invite_users: true,
};

export class TelegramApi {
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly token: string, options: TelegramApiOptions = {}) {
    this.apiBase = options.apiBase ?? "https://api.telegram.org";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.apiBase}/bot${this.token}/${method}`;
    let lastError: TelegramError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let envelope: TelegramEnvelope<T>;
      try {
        const response = await fetchJson<TelegramEnvelope<T>>(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          timeoutMs: this.timeoutMs,
        });
        envelope = response.body;
        if (!envelope || typeof envelope.ok !== "boolean") {
          throw new TelegramError(0, "پاسخ نامعتبر از Telegram API");
        }
      } catch (error) {
        // تلگرام خطاهای 4xx/5xx را با بدنه‌ی JSON برمی‌گرداند
        if (error instanceof HttpError) {
          let envelopeFromError: TelegramEnvelope<T> | null = null;
          try {
            envelopeFromError = JSON.parse(error.body) as TelegramEnvelope<T>;
          } catch {
            envelopeFromError = null;
          }

          if (envelopeFromError && typeof envelopeFromError.error_code === "number") {
            const telegramError = new TelegramError(
              envelopeFromError.error_code,
              envelopeFromError.description ?? `HTTP ${error.status}`,
              envelopeFromError.parameters?.retry_after,
            );
            lastError = telegramError;
            if (
              (telegramError.code === 429 || telegramError.code >= 500) &&
              attempt < this.maxRetries
            ) {
              const waitMs = telegramError.code === 429
                ? Math.min((telegramError.retryAfter ?? 1) * 1000, 4000)
                : 400 * 2 ** attempt;
              await sleep(waitMs);
              continue;
            }
            throw telegramError;
          }

          if (attempt < this.maxRetries) {
            await sleep(300 * 2 ** attempt);
            continue;
          }
          throw new TelegramError(
            error.status,
            `HTTP ${error.status}: ${error.body.slice(0, 200)}`,
          );
        }

        if (attempt < this.maxRetries) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
        if (error instanceof TelegramError) throw error;
        throw new TelegramError(
          0,
          `خطای شبکه در تماس با Telegram: ${(error as Error).message}`,
        );
      }

      if (envelope.ok) return envelope.result as T;

      const code = envelope.error_code ?? 0;
      const description = envelope.description ?? "خطای نامشخص تلگرام";
      const retryAfter = envelope.parameters?.retry_after;
      lastError = new TelegramError(code, description, retryAfter);

      if (code === 429 && attempt < this.maxRetries) {
        await sleep(Math.min((retryAfter ?? 1) * 1000, 4000));
        continue;
      }
      if (code >= 500 && attempt < this.maxRetries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      break;
    }

    throw lastError ?? new TelegramError(0, "خطای نامشخص تلگرام");
  }

  // ─── messaging ──────────────────────────────────────────────────────────────
  sendMessage(chatId: ChatId, text: string, extra: SendMessageExtra = {}): Promise<TgMessage> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: extra.preview !== true },
    };
    if (extra.markup) payload.reply_markup = styleMarkup(extra.markup);
    if (extra.replyTo) payload.reply_to_message_id = extra.replyTo;
    if (extra.silent) payload.disable_notification = true;
    return this.call<TgMessage>("sendMessage", payload);
  }

  editMessageText(
    chatId: ChatId,
    messageId: number,
    text: string,
    extra: SendMessageExtra = {},
  ): Promise<TgMessage | true> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: extra.preview !== true },
    };
    if (extra.markup) payload.reply_markup = styleMarkup(extra.markup);
    return this.call<TgMessage | true>("editMessageText", payload);
  }

  editReplyMarkup(
    chatId: ChatId,
    messageId: number,
    markup?: TgInlineKeyboardMarkup,
  ): Promise<TgMessage | true> {
    return this.call<TgMessage | true>("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: styleMarkup(markup) ?? { inline_keyboard: [] },
    });
  }

  deleteMessage(chatId: ChatId, messageId: number): Promise<boolean> {
    return this.call<boolean>("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  answerCallback(id: string, text?: string, showAlert = false): Promise<boolean> {
    return this.call<boolean>("answerCallbackQuery", {
      callback_query_id: id,
      text: text ? text.slice(0, 200) : undefined,
      show_alert: showAlert,
    });
  }

  sendMedia(
    chatId: ChatId,
    kind: Exclude<MediaType, "none">,
    fileId: string,
    extra: SendMediaExtra = {},
  ): Promise<TgMessage> {
    const field = kind;
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      [field]: fileId,
      parse_mode: "HTML",
    };
    if (extra.caption) payload.caption = extra.caption;
    if (extra.markup) payload.reply_markup = styleMarkup(extra.markup);
    if (extra.silent) payload.disable_notification = true;
    return this.call<TgMessage>(MEDIA_METHOD[kind], payload);
  }

  pinMessage(chatId: ChatId, messageId: number, silent = true): Promise<boolean> {
    return this.call<boolean>("pinChatMessage", {
      chat_id: chatId,
      message_id: messageId,
      disable_notification: silent,
    });
  }

  forwardMessage(chatId: ChatId, fromChatId: ChatId, messageId: number): Promise<TgMessage> {
    return this.call<TgMessage>("forwardMessage", {
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    });
  }

  // ─── moderation ─────────────────────────────────────────────────────────────
  getChatMember(chatId: ChatId, userId: number): Promise<TgChatMember> {
    return this.call<TgChatMember>("getChatMember", { chat_id: chatId, user_id: userId });
  }

  getChat(chatId: ChatId): Promise<TgChatFullInfo> {
    return this.call<TgChatFullInfo>("getChat", { chat_id: chatId });
  }

  getChatMemberCount(chatId: ChatId): Promise<number> {
    return this.call<number>("getChatMemberCount", { chat_id: chatId });
  }

  banChatMember(chatId: ChatId, userId: number, until?: Date): Promise<boolean> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      user_id: userId,
      revoke_messages: false,
    };
    if (until) payload.until_date = Math.floor(until.getTime() / 1000);
    return this.call<boolean>("banChatMember", payload);
  }

  unbanChatMember(chatId: ChatId, userId: number): Promise<boolean> {
    return this.call<boolean>("unbanChatMember", {
      chat_id: chatId,
      user_id: userId,
      only_if_banned: true,
    });
  }

  restrictChatMember(
    chatId: ChatId,
    userId: number,
    until: Date | undefined,
    permissions: Record<string, boolean> = MUTED_PERMISSIONS,
  ): Promise<boolean> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      user_id: userId,
      permissions,
      use_independent_chat_permissions: true,
    };
    if (until) payload.until_date = Math.floor(until.getTime() / 1000);
    return this.call<boolean>("restrictChatMember", payload);
  }

  unrestrictChatMember(chatId: ChatId, userId: number): Promise<boolean> {
    return this.call<boolean>("restrictChatMember", {
      chat_id: chatId,
      user_id: userId,
      permissions: FULL_PERMISSIONS,
      use_independent_chat_permissions: true,
    });
  }

  // ─── bot setup ──────────────────────────────────────────────────────────────
  getMe(): Promise<TgUser> {
    return this.call<TgUser>("getMe");
  }

  getWebhookInfo(): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("getWebhookInfo");
  }

  setMyCommands(commands: { command: string; description: string }[]): Promise<boolean> {
    return this.call<boolean>("setMyCommands", { commands });
  }

  setChatMenuButton(url: string, text: string): Promise<boolean> {
    return this.call<boolean>("setChatMenuButton", {
      menu_button: { type: "web_app", text, web_app: { url } },
    });
  }
}

/** تقسیم متن طولانی برای عبور از محدودیت 4096 کاراکتری. */
export function splitMessage(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.4) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

// ─── رنگ‌آمیزی خودکار دکمه‌ها ──────────────────────────────────────────────────
// هر دکمه‌ای که به تلگرام می‌رود رنگ می‌گیرد: قرمز=بازگشت/حذف/خاموش
// سبز=خانه/تأیید/روشن/افزودن و آبی برای بقیهٔ اقدام‌ها.

const DANGER_LABEL = /(بازگشت|حذف|خاموش|غیرفعال|لغو|مسدود|توقف|بن |❌|🗑|⛔|🚫|🔴)/;
const SUCCESS_LABEL = /(خانه|داشبورد|منوی اصلی|تأیید|روشن|فعال|افزودن|✅|🟢|➕)/;

function styleButton(button: TgInlineKeyboardButton): TgInlineKeyboardButton {
  if (button.style) return button;
  if (DANGER_LABEL.test(button.text)) return { ...button, style: "danger" };
  if (SUCCESS_LABEL.test(button.text)) return { ...button, style: "success" };
  return { ...button, style: "primary" };
}

/** هر کیبورد خروجی را رنگی می‌کند تا هیچ دکمه‌ای خاکستری نماند. */
export function styleMarkup(
  markup?: TgInlineKeyboardMarkup,
): TgInlineKeyboardMarkup | undefined {
  if (!markup) return markup;
  return {
    inline_keyboard: markup.inline_keyboard.map((row) => row.map(styleButton)),
  };
}
