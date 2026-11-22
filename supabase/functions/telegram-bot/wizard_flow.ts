/**
 * پل بین wizard خالص و ربات: ثبت تعریف‌ها، رندر پرامپت و اجرای تکمیل.
 * ماژول‌ها با registerWizard خود را ثبت می‌کنند؛ admin.ts آن‌ها را import می‌کند.
 */
import type { Permission } from "../_shared/auth.ts";
import { clearSession, startSession } from "../_shared/sessions.ts";
import { keyboard } from "../_shared/keyboards.ts";
import {
  applyWizardChoice,
  applyWizardInput,
  currentField,
  goBackWizard,
  isWizardComplete,
  renderWizardPrompt,
  skipWizardField,
  startWizard,
  type WizardDefinition,
  wizardPrimaryKeyboard,
  type WizardState,
} from "../_shared/wizard.ts";
import { answerCallback, type Ctx, editOrSend, guardAdmin, send, sessionTtl } from "./context.ts";

export interface WizardRegistration {
  definition: WizardDefinition;
  permission: Permission;
  returnTo: string;
  onComplete: (ctx: Ctx, data: Record<string, unknown>) => Promise<void>;
}

const registry = new Map<string, WizardRegistration>();

export function registerWizard(registration: WizardRegistration): void {
  registry.set(registration.definition.id, registration);
}

export function getWizard(id: string): WizardRegistration | undefined {
  return registry.get(id);
}

export function registeredWizards(): string[] {
  return [...registry.keys()];
}

function promptKeyboard(definition: WizardDefinition, state: WizardState) {
  const field = currentField(definition, state);
  return keyboard(wizardPrimaryKeyboard(field, { allowBack: state.index > 0 }));
}

export async function sendWizardPrompt(
  ctx: Ctx,
  definition: WizardDefinition,
  state: WizardState,
): Promise<void> {
  await send(ctx, renderWizardPrompt(definition, state), promptKeyboard(definition, state));
}

async function persist(
  ctx: Ctx,
  definition: WizardDefinition,
  state: WizardState,
  returnTo: string,
) {
  await startSession(
    ctx.sb,
    ctx.userId,
    ctx.chatId,
    `wizard:${definition.id}`,
    { state, returnTo },
    await sessionTtl(ctx),
  );
}

export async function beginWizard(
  ctx: Ctx,
  id: string,
  opts: { overwrite?: Record<string, unknown> } = {},
): Promise<boolean> {
  const registration = registry.get(id);
  if (!registration) {
    await send(ctx, "⚠️ این فرایند تعریف نشده است.");
    return false;
  }
  if (!(await guardAdmin(ctx, registration.permission, { requirePrivate: true }))) return false;

  const state = startWizard(registration.definition);
  if (opts.overwrite) state.data = { ...opts.overwrite };

  await persist(ctx, registration.definition, state, registration.returnTo);
  await sendWizardPrompt(ctx, registration.definition, state);
  return true;
}

/** پردازش متن ورودی وقتی session در حالت wizard است. */
export async function handleWizardInput(ctx: Ctx, id: string, text: string): Promise<boolean> {
  const registration = registry.get(id);
  if (!registration) return false;
  if (!(await guardAdmin(ctx, registration.permission, { requirePrivate: true, silent: true }))) {
    await clearSession(ctx.sb, ctx.userId, ctx.chatId);
    await send(ctx, "⛔ دسترسی شما به این بخش تغییر کرده است.");
    return true;
  }

  const state = await currentState(ctx, id);
  if (!state) return false;

  const applied = applyWizardInput(registration.definition, state, text, {
    timeZone: await ctx.settings.get("timezone"),
    now: ctx.now,
  });

  if (!applied.ok) {
    await send(ctx, `⚠️ ${applied.error ?? "ورودی نامعتبر است."}`);
    await sendWizardPrompt(ctx, registration.definition, state);
    return true;
  }

  if (!applied.done) {
    await persist(ctx, registration.definition, applied.state, registration.returnTo);
    await sendWizardPrompt(ctx, registration.definition, applied.state);
    return true;
  }

  await finishWizard(ctx, registration, applied.state);
  return true;
}

async function currentState(ctx: Ctx, id: string): Promise<WizardState | null> {
  const { getSession } = await import("../_shared/sessions.ts");
  const session = await getSession(ctx.sb, ctx.userId, ctx.chatId);
  if (!session || session.state !== `wizard:${id}`) return null;
  const state = session.payload.state as WizardState | undefined;
  if (!state) return null;
  return state;
}

async function finishWizard(
  ctx: Ctx,
  registration: WizardRegistration,
  state: WizardState,
): Promise<void> {
  const validationError = registration.definition.validate?.(state.data) ?? null;
  if (validationError) {
    await send(ctx, `⚠️ ${validationError}\nفرایند از ابتدا شروع می‌شود.`);
    await beginWizard(ctx, registration.definition.id);
    return;
  }

  await clearSession(ctx.sb, ctx.userId, ctx.chatId);
  try {
    await registration.onComplete(ctx, state.data);
  } catch (error) {
    console.error("wizard completion failed:", error);
    await ctx.log.error("wizard completion failed", {
      wizard: registration.definition.id,
      error: (error as Error).message,
    });
    await send(ctx, `❌ خطا در ذخیره‌سازی: ${(error as Error).message}`);
  }
}

export async function handleWizardCallback(ctx: Ctx, parts: string[]): Promise<boolean> {
  const sub = parts[1];
  const { getSession } = await import("../_shared/sessions.ts");
  const session = await getSession(ctx.sb, ctx.userId, ctx.chatId);
  if (!session || !session.state.startsWith("wizard:")) {
    await answerCallback(ctx, "این فرایند منقضی شده است.", true);
    return true;
  }

  const id = session.state.slice("wizard:".length);
  const registration = registry.get(id);
  const state = session.payload.state as WizardState | undefined;
  if (!registration || !state) {
    await clearSession(ctx.sb, ctx.userId, ctx.chatId);
    await answerCallback(ctx, "فرایند نامعتبر است.", true);
    return true;
  }

  if (!(await guardAdmin(ctx, registration.permission, { requirePrivate: true, silent: true }))) {
    await clearSession(ctx.sb, ctx.userId, ctx.chatId);
    await editOrSend(ctx, "⛔ دسترسی شما تغییر کرده است.");
    return true;
  }

  if (sub === "x") {
    await clearSession(ctx.sb, ctx.userId, ctx.chatId);
    await answerCallback(ctx, "لغو شد.");
    await editOrSend(
      ctx,
      "❌ فرایند لغو شد.",
      keyboard([
        [{ text: "◀️ بازگشت", callback_data: registration.returnTo }],
        [{ text: "🏠 داشبورد", callback_data: "a:h" }],
      ]),
    );
    return true;
  }

  if (sub === "s") {
    const skipped = skipWizardField(registration.definition, state);
    if (!skipped.ok) {
      await answerCallback(ctx, skipped.error ?? "قابل رد کردن نیست.", true);
      return true;
    }
    if (skipped.done) await finishWizard(ctx, registration, skipped.state);
    else {
      await persist(ctx, registration.definition, skipped.state, registration.returnTo);
      await editOrSend(
        ctx,
        renderWizardPrompt(registration.definition, skipped.state),
        promptKeyboard(registration.definition, skipped.state),
      );
    }
    await answerCallback(ctx, "رد شد.");
    return true;
  }

  if (sub === "b") {
    const previous = goBackWizard(registration.definition, state);
    await persist(ctx, registration.definition, previous, registration.returnTo);
    await editOrSend(
      ctx,
      renderWizardPrompt(registration.definition, previous),
      promptKeyboard(registration.definition, previous),
    );
    await answerCallback(ctx, "مرحله قبل.");
    return true;
  }

  if (sub === "c") {
    const value = parts.slice(2).join(":");
    const chosen = applyWizardChoice(registration.definition, state, value);
    if (!chosen.ok) {
      await answerCallback(ctx, chosen.error ?? "گزینه نامعتبر است.", true);
      return true;
    }
    if (chosen.done) await finishWizard(ctx, registration, chosen.state);
    else {
      await persist(ctx, registration.definition, chosen.state, registration.returnTo);
      await editOrSend(
        ctx,
        renderWizardPrompt(registration.definition, chosen.state),
        promptKeyboard(registration.definition, chosen.state),
      );
    }
    await answerCallback(ctx, "ثبت شد.");
    return true;
  }

  await answerCallback(ctx, "اقدام ناشناخته است.", true);
  return true;
}

export function isWizardDone(definition: WizardDefinition, state: WizardState): boolean {
  return isWizardComplete(definition, state);
}
