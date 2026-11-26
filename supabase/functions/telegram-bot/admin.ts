/**
 * مسیریاب داشبورد مدیریت. هر callback ابتدا هویت مدیر را از DB تازه می‌خواند
 * (ctx.admin) و سپس مجوز دقیق بخش را بررسی می‌کند.
 */
import { clearSession, getSession } from "../_shared/sessions.ts";
import type { Permission } from "../_shared/auth.ts";
import { keyboard } from "../_shared/keyboards.ts";
import {
  answerCallback,
  type Ctx,
  editOrSend,
  logAdminAction,
  send,
  tokenMatches,
} from "./context.ts";
import { handleDashboardCallback, renderAdminHome } from "./dashboard.ts";
import { handleStatsCallback } from "./stats.ts";
import { handleUsersCallback, handleUsersInput, runUserConfirm } from "./users.ts";
import { handleAdsCallback, runAdConfirm } from "./advertisements.ts";
import { handleBroadcastCallback, runBroadcastConfirm } from "./broadcast.ts";
import { handleScheduleCallback, runScheduleConfirm } from "./schedule.ts";
import { handleAiCallback } from "./ai.ts";
import { handleContentCallback, handleContentInput, runContentConfirm } from "./content.ts";
import { handleGroupsCallback, handleGroupsInput } from "./groups.ts";
import {
  handleSettingsCallback,
  handleSettingsCallbackExtra,
  handleSettingsInput,
  runSettingsConfirm,
} from "./settings.ts";
import { handleSecurityCallback, runSecurityConfirm } from "./security.ts";
import { handleToolsCallback, runToolsConfirm } from "./tools.ts";
import { handleAnimeInput } from "./anime.ts";
import { runGroupConfirm } from "./moderation.ts";
import { handleWizardCallback } from "./wizard_flow.ts";
import type { PendingConfirm } from "./context.ts";

export const SECTION_PERMISSIONS: Record<string, Permission> = {
  h: "stats.read",
  me: "stats.read",
  st: "stats.read",
  us: "users.read",
  u: "users.read",
  bn: "bans.manage",
  ad: "ads.read",
  bc: "broadcast.read",
  sh: "schedule.manage",
  ai: "ai.read",
  nw: "content.read",
  ct: "content.read",
  gr: "groups.read",
  g: "groups.read",
  se: "settings.manage",
  sc: "security.read",
  tl: "tools.use",
};

const DENY_TEXT = "⛔ دسترسی لازم برای این بخش را ندارید.";

export async function handleAdminCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  if (parts[0] !== "a") return false;

  if (!ctx.admin) {
    await answerCallback(ctx, DENY_TEXT, true);
    if (!ctx.update.callback_query) await send(ctx, DENY_TEXT);
    return true;
  }

  const section = parts[1] ?? "h";
  const required = SECTION_PERMISSIONS[section];
  if (required && !ctx.admin.permissions.includes(required)) {
    await answerCallback(ctx, DENY_TEXT, true);
    return true;
  }

  if (await handleDashboardCallback(ctx, parts)) return true;
  if (await handleStatsCallback(ctx, parts)) return true;
  if (await handleUsersCallback(ctx, parts)) return true;
  if (await handleAdsCallback(ctx, parts)) return true;
  if (await handleBroadcastCallback(ctx, parts)) return true;
  if (await handleScheduleCallback(ctx, parts)) return true;
  if (await handleAiCallback(ctx, parts)) return true;
  if (await handleContentCallback(ctx, parts)) return true;
  if (await handleGroupsCallback(ctx, parts)) return true;
  if (await handleSettingsCallback(ctx, parts)) return true;
  if (await handleSettingsCallbackExtra(ctx, parts)) return true;
  if (await handleSecurityCallback(ctx, parts)) return true;
  if (await handleToolsCallback(ctx, parts)) return true;

  // دکمهٔ قدیمی/ناشناخته: داشبورد دوباره باز می‌شود تا کاربر گیر نکند.
  await renderAdminHome(ctx);
  await answerCallback(ctx, "داشبورد باز شد.");
  return true;
}

export async function handleInputAction(
  ctx: Ctx,
  action: string,
  args: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  if (await handleUsersInput(ctx, action, args, text)) return true;
  if (await handleSettingsInput(ctx, action, args, text)) return true;
  if (await handleGroupsInput(ctx, action, args, text)) return true;
  if (await handleContentInput(ctx, action, args, text)) return true;
  if (await handleAnimeInput(ctx, action, args, text)) return true;
  return false;
}

export async function handleConfirmCallback(
  ctx: Ctx,
  kind: string,
  token: string,
): Promise<boolean> {
  const session = await getSession(ctx.sb, ctx.userId, ctx.chatId);
  const pending = session?.state === "confirm"
    ? (session.payload.confirm as PendingConfirm | undefined)
    : undefined;

  if (!session || !pending || !tokenMatches(pending.token, token)) {
    await answerCallback(ctx, "این تأیید منقضی شده است. عملیات را دوباره شروع کنید.", true);
    return true;
  }

  if (kind === "n") {
    await clearSession(ctx.sb, ctx.userId, ctx.chatId);
    await answerCallback(ctx, "لغو شد.");
    await editOrSend(
      ctx,
      "❌ عملیات لغو شد.",
      keyboard([
        [{ text: "🏠 داشبورد", callback_data: "a:h" }],
        [{ text: "🏠 منوی اصلی", callback_data: "u:m" }],
      ]),
    );
    return true;
  }

  if (kind !== "y") {
    await answerCallback(ctx, "درخواست نامعتبر است.", true);
    return true;
  }

  await clearSession(ctx.sb, ctx.userId, ctx.chatId);
  await answerCallback(ctx, "در حال اجرا…");

  try {
    const action = pending.action;
    const args = pending.args ?? {};

    if (action.startsWith("group_")) {
      await runGroupConfirm(ctx, action, args);
      return true;
    }

    if (!ctx.admin) {
      await send(ctx, DENY_TEXT);
      return true;
    }

    await logAdminAction(ctx, `confirm:${action}`, "confirm", pending.token, args);

    if (await runUserConfirm(ctx, action, args)) return true;
    if (await runAdConfirm(ctx, action, args)) return true;
    if (await runBroadcastConfirm(ctx, action, args)) return true;
    if (await runScheduleConfirm(ctx, action, args)) return true;
    if (await runContentConfirm(ctx, action, args)) return true;
    if (await runSettingsConfirm(ctx, action, args)) return true;
    if (await runSecurityConfirm(ctx, action, args)) return true;
    if (await runToolsConfirm(ctx, action, args)) return true;

    await editOrSend(
      ctx,
      "⚠️ این عملیات دیگر پشتیبانی نمی‌شود.",
      keyboard([
        [{ text: "🏠 داشبورد", callback_data: "a:h" }],
      ]),
    );
  } catch (error) {
    await ctx.log.error("confirm action failed", {
      action: pending.action,
      error: (error as Error).message,
    });
    await send(ctx, `❌ اجرای عملیات ناموفق بود: ${(error as Error).message}`);
  }
  return true;
}

export async function handleWizardCallbackEntry(ctx: Ctx, parts: string[]): Promise<boolean> {
  return await handleWizardCallback(ctx, parts);
}

export async function adminHome(ctx: Ctx): Promise<void> {
  await renderAdminHome(ctx, false);
}
