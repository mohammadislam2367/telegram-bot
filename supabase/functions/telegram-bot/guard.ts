/**
 * نگهبان گروه — قفل‌های محتوایی، ضدلینک، فیلتر کلمات، ضدفیشینگ، ضد فلوود،
 * خوش‌آمد/خداحافظی و ثبت هشدارها.
 */
import {
  btn,
  card,
  type Cfg,
  dbSelect,
  deleteMessage,
  faNum,
  kb,
  mention,
  sendMessage,
  type TgMessage,
  unbanMember,
} from "./core.ts";
import { detectViolation, isPhishing, normalizeFa } from "./locks.ts";
import {
  addWarning,
  bannedWords,
  clearWarnings,
  isGroupAdmin,
  isVip,
  loadSettings,
  punish,
  rememberUser,
  renderTemplate,
  type Settings,
} from "./store.ts";

const recent = new Map<string, number[]>();
const WINDOW_CAP = 200;

function floodHit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((at) => now - at < windowMs);
  list.push(now);
  recent.set(key, list.slice(-WINDOW_CAP));
  return list.length > limit;
}

/** یک اخطار ثبت می‌کند و در صورت رسیدن به سقف، مجازات را اعمال می‌کند. */
export async function strike(
  cfg: Cfg,
  message: TgMessage,
  settings: Settings,
  reason: string,
): Promise<string> {
  const user = message.from;
  if (!user) return "";
  const total = await addWarning(cfg, message.chat.id, user.id, reason, 0);
  if (total < settings.warn_limit) {
    return `اخطار ${faNum(total)} از ${faNum(settings.warn_limit)} ثبت شد.`;
  }
  const result = await punish(cfg, message.chat.id, user.id, settings);
  await clearWarnings(cfg, message.chat.id, user.id);
  return `به سقف اخطار رسید و ${result}`;
}

async function reject(
  cfg: Cfg,
  message: TgMessage,
  settings: Settings,
  title: string,
  reason: string,
  detail: string,
): Promise<void> {
  await deleteMessage(cfg, message.chat.id, message.message_id);
  const note = await strike(cfg, message, settings, reason);
  const text = card(title, [
    `${message.from ? mention(message.from) : "کاربر"} عزیز، ${detail}`,
    note,
  ]);
  await sendMessage(cfg, message.chat.id, text);
}

/** true یعنی پیام نباید بیشتر پردازش شود. */
export async function guardMessage(cfg: Cfg, message: TgMessage): Promise<boolean> {
  const chat = message.chat;
  const from = message.from;
  if (!from || from.is_bot) return false;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;

  await rememberUser(cfg, from);
  const settings = await loadSettings(cfg, chat);

  if (message.new_chat_members?.length) {
    await onJoin(cfg, message, settings);
    return true;
  }
  if (message.left_chat_member) {
    await onLeave(cfg, message, settings);
    return true;
  }

  if (await isGroupAdmin(cfg, chat.id, from.id)) return false;
  if (await isVip(cfg, chat.id, from.id)) return false;

  const text = message.text ?? message.caption ?? "";

  const violation = detectViolation(message, settings.locks);
  if (violation) {
    await reject(
      cfg,
      message,
      settings,
      "🔐 <b>قفل گروه</b>",
      `قفل ${violation.label}`,
      `«${violation.label}» در این گروه قفل است.`,
    );
    return true;
  }

  const hasLink = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|tg:\/\/)/i.test(text);
  if (settings.antilink_enabled && hasLink) {
    await reject(cfg, message, settings, "🔗 <b>ضدلینک</b>", "لینک", "ارسال لینک مجاز نیست.");
    return true;
  }

  if (settings.block_forwards && (message.forward_origin || message.forward_date)) {
    await reject(cfg, message, settings, "📤 <b>ضدفوروارد</b>", "فوروارد", "فوروارد مجاز نیست.");
    return true;
  }

  const body = normalizeFa(text);
  if (body) {
    const words = await bannedWords(cfg, chat.id);
    const hit = words.find((word) => word && body.includes(normalizeFa(word)));
    if (hit) {
      await reject(
        cfg,
        message,
        settings,
        "🧹 <b>فیلتر کلمات</b>",
        `کلمهٔ ممنوع: ${hit}`,
        "این کلمه در گروه ممنوع است.",
      );
      return true;
    }
  }

  if (settings.antispam_enabled && isPhishing(text)) {
    await reject(
      cfg,
      message,
      settings,
      "🛡 <b>ضدفیشینگ</b>",
      "لینک کلاهبرداری",
      "این پیام شبیه کلاهبرداری است و حذف شد.",
    );
    return true;
  }

  if (settings.antispam_enabled) {
    const key = `${chat.id}:${from.id}`;
    const windowMs = settings.flood_window_seconds * 1000;
    if (floodHit(key, settings.flood_limit, windowMs)) {
      await deleteMessage(cfg, chat.id, message.message_id);
      const total = await addWarning(cfg, chat.id, from.id, "فلوود", 0);
      if (total >= settings.warn_limit) {
        const result = await punish(cfg, chat.id, from.id, settings);
        await clearWarnings(cfg, chat.id, from.id);
        await sendMessage(
          cfg,
          chat.id,
          card("🌊 <b>ضد فلوود</b>", [
            `${mention(from)}: ${result}`,
          ]),
        );
      } else {
        await sendMessage(
          cfg,
          chat.id,
          card("🌊 <b>آرام‌تر</b>", [
            `${mention(from)} عزیز، در ${faNum(settings.flood_window_seconds)} ثانیه بیشتر از ` +
            `${faNum(settings.flood_limit)} پیام نفرست.`,
          ]),
        );
      }
      return true;
    }
  }

  return false;
}

async function onJoin(cfg: Cfg, message: TgMessage, settings: Settings): Promise<void> {
  const joined = (message.new_chat_members ?? []).filter((user) => !user.is_bot);
  for (const user of joined) {
    await rememberUser(cfg, user);
    if (settings.verify_enabled) {
      await sendMessage(
        cfg,
        message.chat.id,
        card("✅ <b>تأیید هویت</b>", [
          `${mention(user)} عزیز، برای ارسال پیام روی دکمهٔ زیر بزن.`,
        ]),
        { markup: kb([[btn("✅ من ربات نیستم", `p:verify:${user.id}`)]]) },
      );
      continue;
    }
    if (!settings.welcome_enabled) continue;
    const text = renderTemplate(settings.welcome_text, user, {
      chatId: message.chat.id,
      groupTitle: message.chat.title ?? "گروه",
      botUsername: cfg.botUsername,
      timeZone: "Asia/Tehran",
    });
    await sendMessage(cfg, message.chat.id, text, {
      markup: kb([[btn("📜 قوانین", "p:rules")]]),
    });
  }
}

async function onLeave(cfg: Cfg, message: TgMessage, settings: Settings): Promise<void> {
  const user = message.left_chat_member;
  if (!user || user.is_bot || !settings.goodbye_enabled) return;
  const text = renderTemplate(settings.goodbye_text, user, {
    chatId: message.chat.id,
    groupTitle: message.chat.title ?? "گروه",
    botUsername: cfg.botUsername,
    timeZone: "Asia/Tehran",
  });
  await sendMessage(cfg, message.chat.id, text);
}

/** آزادکردن همهٔ کاربران مسدود/سکوت‌شدهٔ گروه. */
export async function clearAllBans(cfg: Cfg, chatId: number): Promise<number> {
  const rows = await dbSelect<{ user_id: number }>(
    cfg,
    "group_bans",
    `group_id=eq.${chatId}&is_active=eq.true&select=user_id&limit=200`,
  );
  let count = 0;
  for (const row of rows) if (await unbanMember(cfg, chatId, row.user_id)) count++;
  return count;
}
