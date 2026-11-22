/**
 * Publishing pipeline — ارسال تبلیغ/پست زمان‌بندی‌شده/محتوای منتشرشده.
 * هم داشبورد و هم scheduler از همین ماژول استفاده می‌کنند.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { splitMessage, type TelegramApi, TelegramError } from "./telegram.ts";
import type { SettingsStore } from "./settings.ts";
import { escapeHtml, truncate } from "./validation.ts";
import type { TgInlineKeyboardMarkup } from "./types.ts";
import type { AdRow, ContentPostRow, MediaType, ScheduledPostRow } from "./types.ts";

export interface PublishDeps {
  sb: SupabaseClient;
  tg: TelegramApi;
  settings: SettingsStore;
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
  unreachable?: boolean;
  permanent?: boolean;
}

export interface RichMessage {
  text: string;
  mediaType?: MediaType;
  mediaFileId?: string | null;
  buttons?: { text: string; url: string }[];
  html?: boolean;
}

export function parseStoredButtons(value: unknown): { text: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  const result: { text: string; url: string }[] = [];
  for (const item of value) {
    if (
      item && typeof item === "object" &&
      typeof (item as { text?: unknown }).text === "string" &&
      typeof (item as { url?: unknown }).url === "string"
    ) {
      result.push({
        text: (item as { text: string }).text.slice(0, 64),
        url: (item as { url: string }).url.slice(0, 2048),
      });
    }
  }
  return result.slice(0, 3);
}

export function buildMarkup(
  buttons: { text: string; url: string }[],
): TgInlineKeyboardMarkup | undefined {
  if (buttons.length === 0) return undefined;
  return { inline_keyboard: buttons.map((button) => [{ text: button.text, url: button.url }]) };
}

export function resolveTarget(explicit: string | null | undefined, fallbackTarget: string): string {
  const value = (explicit ?? "").trim();
  if (value.length > 0) return value;
  return fallbackTarget.trim();
}

/** ارسال متن/مدیا با رعایت محدودیت‌های تلگرام و تقسیم متن طولانی. */
export async function sendRichMessage(
  tg: TelegramApi,
  chatId: string | number,
  message: RichMessage,
): Promise<SendResult> {
  const markup = buildMarkup(message.buttons ?? []);
  const text = message.html ? message.text : escapeHtml(message.text);

  try {
    if (message.mediaType && message.mediaType !== "none" && message.mediaFileId) {
      const sent = await tg.sendMedia(chatId, message.mediaType, message.mediaFileId, {
        caption: truncate(text, 1024),
        markup,
      });
      return { ok: true, messageId: sent.message_id };
    }

    const chunks = splitMessage(text, 3800);
    let lastId: number | undefined;
    for (let i = 0; i < chunks.length; i++) {
      const sent = await tg.sendMessage(chatId, chunks[i], {
        markup: i === chunks.length - 1 ? markup : undefined,
        preview: false,
      });
      lastId = sent.message_id;
    }
    return { ok: true, messageId: lastId };
  } catch (error) {
    if (error instanceof TelegramError) {
      if (error.isNotModified) return { ok: true };
      return {
        ok: false,
        error: truncate(error.description, 300),
        unreachable: error.isUserUnreachable,
        permanent: error.code === 400 || error.code === 403,
      };
    }
    return { ok: false, error: truncate((error as Error).message, 300) };
  }
}

export function advertisementText(ad: AdRow, label: string, html = true): string {
  const body = html ? escapeHtml(ad.body) : ad.body;
  if (!ad.label_enabled) return body;
  const badge = `🔹 <b>${escapeHtml(label || "تبلیغ")}</b>`;
  return `${badge}\n\n${body}`;
}

export async function publishAdvertisement(
  deps: PublishDeps,
  ad: AdRow,
): Promise<SendResult & { target: string }> {
  const defaultTarget = (await deps.settings.get("ads_default_target")) ||
    (await deps.settings.get("channel_target"));
  const target = resolveTarget(ad.target_chat, defaultTarget);
  if (!target) return { ok: false, error: "مقصد انتشار تنظیم نشده است.", target: "" };

  const result = await sendRichMessage(deps.tg, target, {
    text: advertisementText(ad, await deps.settings.get("ads_label")),
    mediaType: ad.media_type,
    mediaFileId: ad.media_file_id,
    buttons: parseStoredButtons(ad.buttons),
    html: true,
  });
  return { ...result, target };
}

export async function publishScheduledPost(
  deps: PublishDeps,
  post: ScheduledPostRow,
): Promise<SendResult & { target: string }> {
  const defaultTarget = await deps.settings.get("channel_target");
  const target = resolveTarget(post.target_chat, defaultTarget);
  if (!target) return { ok: false, error: "کانال پیش‌فرض تنظیم نشده است.", target: "" };

  const header = post.title ? `<b>${escapeHtml(post.title)}</b>\n\n` : "";
  const result = await sendRichMessage(deps.tg, target, {
    text: `${header}${escapeHtml(post.body)}`,
    mediaType: post.media_type,
    mediaFileId: post.media_file_id,
    buttons: parseStoredButtons(post.buttons),
    html: true,
  });
  return { ...result, target };
}

export async function publishContentPost(
  deps: PublishDeps,
  post: ContentPostRow,
): Promise<SendResult & { target: string }> {
  const defaultTarget = await deps.settings.get("channel_target");
  const target = resolveTarget(post.target_chat, defaultTarget);
  if (!target) return { ok: false, error: "کانال پیش‌فرض تنظیم نشده است.", target: "" };

  const result = await sendRichMessage(deps.tg, target, {
    text: `<b>${escapeHtml(post.title)}</b>\n\n${escapeHtml(post.body)}`,
    mediaType: post.media_type,
    mediaFileId: post.media_file_id,
    buttons: parseStoredButtons(post.buttons),
    html: true,
  });

  if (result.ok && result.messageId && post.is_pinned) {
    try {
      await deps.tg.pinMessage(target, result.messageId, true);
    } catch (error) {
      console.warn("pin failed:", (error as Error).message);
    }
  }
  return { ...result, target };
}
