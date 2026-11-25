/** دستورات چت خصوصی (کاربر + مدیر). */
import { keyboard } from "../_shared/keyboards.ts";
import { clearSession } from "../_shared/sessions.ts";
import { divider, faDateTime } from "../_shared/texts.ts";
import { displayName } from "../_shared/texts.ts";
import { renderAdminHome, renderOwnerPanel, renderUserHelp, renderUserHome } from "./dashboard.ts";
import { commandAnime } from "./anime.ts";
import { commandNews } from "./news.ts";
import { handleOneShotAi, startUserChat } from "./ai.ts";
import {
  commandDeleteDataRequest,
  commandPrivacy,
  commandStartOptIn,
  commandStop,
  renderProfile,
} from "./users.ts";
import { answerCallback, type Ctx, editOrSend, send } from "./context.ts";
import { handleOwnerWarningCommand } from "./warning.ts";
import { privateHome } from "./digi_panel.ts";

export interface ParsedCommand {
  command: string;
  args: string;
}

export function parsePrivateCommand(text: string, botUsername: string): ParsedCommand | null {
  const match = text.match(/^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,32}))?\s*([\s\S]*)$/);
  if (!match) return null;
  const [, command, mention, args] = match;
  if (mention && mention.toLowerCase() !== botUsername.toLowerCase()) return null;
  return { command: command.toLowerCase(), args: args.trim() };
}

export async function handlePrivateCommand(ctx: Ctx, parsed: ParsedCommand): Promise<void> {
  const { command, args } = parsed;

  switch (command) {
    case "start": {
      await commandStartOptIn(ctx);
      if (args.toLowerCase() === "admin") {
        if (ctx.admin) {
          await renderAdminHome(ctx, false);
          return;
        }
        await send(ctx, "⛔ شما مدیر مجاز ربات نیستید.");
      }
      // مدیران ربات کارت جدید اسپیکسل را می‌بینند؛ کاربران عادی منوی خودشان.
      if (ctx.admin) {
        const home = privateHome({
          cfg: ctx.cfg,
          sb: ctx.sb,
          tg: ctx.tg,
          settings: ctx.settings,
          log: ctx.log,
          groupAdmins: ctx.groupAdmins,
        }, ctx.userId);
        await ctx.tg.sendMessage(ctx.chatId, home.text, {
          preview: false,
          markup: home.markup as never,
        });
        return;
      }
      await renderUserHome(ctx);
      return;
    }

    case "help": {
      await renderUserHelp(ctx);
      return;
    }

    case "admin": {
      if (!ctx.admin) {
        await send(ctx, "⛔ این بخش فقط برای مدیران مجاز است.");
        return;
      }
      await renderAdminHome(ctx, false);
      return;
    }

    case "ai": {
      await handleOneShotAi(ctx, args);
      return;
    }

    case "owner": {
      await renderOwnerPanel(ctx);
      return;
    }

    case "warning":
    case "setwarning": {
      await handleOwnerWarningCommand(ctx, args);
      return;
    }

    case "anime":
    case "search": {
      await commandAnime(ctx, args);
      return;
    }

    case "news": {
      await commandNews(ctx);
      return;
    }

    case "profile":
    case "me": {
      await renderProfile(ctx);
      return;
    }

    case "privacy": {
      await commandPrivacy(ctx);
      return;
    }

    case "stop": {
      await commandStop(ctx);
      return;
    }

    case "deletedata":
    case "delete": {
      await commandDeleteDataRequest(ctx);
      return;
    }

    case "cancel": {
      await clearSession(ctx.sb, ctx.userId, ctx.chatId);
      await send(
        ctx,
        "✅ عملیات جاری لغو شد. هر وقت خواستی /start را بزن.",
        keyboard([
          [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
        ]),
      );
      return;
    }

    case "id": {
      await send(
        ctx,
        [
          "<b>🆔 شناسه‌ها</b>",
          divider(),
          `کاربر: <code>${ctx.userId}</code>`,
          `چت: <code>${ctx.chatId}</code>`,
          `نوع چت: ${ctx.chatType}`,
          `نام: ${displayName(ctx.user)}`,
          `زمان: ${faDateTime(ctx.now)}`,
        ].join("\n"),
      );
      return;
    }

    case "chat": {
      await startUserChat(ctx);
      return;
    }

    case "menu": {
      const home = privateHome({
        cfg: ctx.cfg,
        sb: ctx.sb,
        tg: ctx.tg,
        settings: ctx.settings,
        log: ctx.log,
        groupAdmins: ctx.groupAdmins,
      }, ctx.userId);
      await ctx.tg.sendMessage(ctx.chatId, home.text, {
        preview: false,
        markup: home.markup as never,
      });
      return;
    }

    default: {
      await send(
        ctx,
        "🤔 این دستور را نمی‌شناسم. راهنما را ببین یا از دکمه‌ها استفاده کن.",
        keyboard([
          [{ text: "ℹ️ راهنما", callback_data: "u:hl" }],
          [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
        ]),
      );
      return;
    }
  }
}

export async function handleStartPayload(ctx: Ctx, payload: string): Promise<boolean> {
  if (payload === "owner") {
    await renderOwnerPanel(ctx);
    return true;
  }

  if (payload === "admin") {
    if (ctx.admin) {
      await renderAdminHome(ctx, false);
      return true;
    }
    await answerCallback(ctx, "دسترسی مدیریتی ندارید.", true);
    return true;
  }
  return false;
}

export { editOrSend };
