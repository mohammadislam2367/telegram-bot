/**
 * Table-driven wizard engine — تمام گفت‌وگوهای چندمرحله‌ای (تبلیغ، همگانی،
 * محتوا، تنظیمات) از این منطق خالص استفاده می‌کنند تا تست‌پذیر و بدون state
 * در حافظه باشند.
 */
import {
  escapeHtml,
  isValidUrl,
  normalizeDigits,
  parseButtons,
  parseChatTarget,
  parseScheduleInput,
  sanitizeText,
} from "./validation.ts";

export type FieldKind =
  | "text"
  | "paragraph"
  | "int"
  | "url"
  | "telegram_target"
  | "buttons"
  | "schedule"
  | "choice";

export interface WizardChoice {
  value: string;
  label: string;
}

export interface WizardField {
  key: string;
  label: string;
  prompt: string;
  kind: FieldKind;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  choices?: readonly WizardChoice[];
}

export interface WizardDefinition {
  id: string;
  title: string;
  fields: readonly WizardField[];
  /** اعتبارسنجی نهایی روی همه‌ی داده‌ها (قواعد بین‌فیلدی). */
  validate?: (data: Record<string, unknown>) => string | null;
}

export interface WizardState {
  wizard: string;
  index: number;
  data: Record<string, unknown>;
}

export interface WizardContext {
  timeZone: string;
  now?: Date;
}

export const WIZARD_SKIP = "-";
export const WIZARD_CANCEL = "w:x";
export const WIZARD_BACK = "w:b";
export const WIZARD_PREVIEW = "w:p";
export const WIZARD_CONFIRM = "w:ok";

export function startWizard(definition: WizardDefinition): WizardState {
  return { wizard: definition.id, index: 0, data: {} };
}

export function currentField(
  definition: WizardDefinition,
  state: WizardState,
): WizardField | undefined {
  return definition.fields[state.index];
}

export function isWizardComplete(
  definition: WizardDefinition,
  state: WizardState,
): boolean {
  return state.index >= definition.fields.length;
}

function toFa(value: number): string {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

export function wizardProgress(definition: WizardDefinition, state: WizardState): string {
  const total = definition.fields.length;
  const step = Math.min(state.index + 1, total);
  return `مرحله ${toFa(step)} از ${toFa(total)}`;
}

export function renderWizardPrompt(
  definition: WizardDefinition,
  state: WizardState,
): string {
  const field = currentField(definition, state);
  if (!field) {
    return `<b>${escapeHtml(definition.title)}</b>\n\nپیش‌نمایش آماده است.`;
  }

  const lines: string[] = [
    `<b>${escapeHtml(definition.title)}</b>`,
    "",
    `<b>${escapeHtml(field.label)}</b>`,
    field.prompt,
    "",
    `<i>${wizardProgress(definition, state)}</i>`,
  ];

  if (field.required === false) {
    lines.push(`<i>برای رد کردن این مرحله ${"<code>-</code>"} بفرستید.</i>`);
  }
  return lines.join("\n");
}

export type FieldValidation =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function validateWizardField(
  field: WizardField,
  raw: string,
  context: WizardContext,
): FieldValidation {
  const value = sanitizeText(raw, field.maxLength ?? 4000);

  switch (field.kind) {
    case "text":
    case "paragraph": {
      const min = field.minLength ?? (field.kind === "text" ? 2 : 3);
      const max = field.maxLength ?? (field.kind === "text" ? 120 : 4000);
      if (value.length < min) {
        return { ok: false, error: `حداقل ${min} کاراکتر لازم است.` };
      }
      if (value.length > max) {
        return { ok: false, error: `حداکثر ${max} کاراکتر مجاز است.` };
      }
      return { ok: true, value };
    }
    case "int": {
      const digits = normalizeDigits(value).replace(/[^\d-]/g, "");
      const number = Number(digits);
      if (!Number.isFinite(number) || !Number.isInteger(number)) {
        return { ok: false, error: "یک عدد صحیح وارد کنید." };
      }
      if (field.min !== undefined && number < field.min) {
        return { ok: false, error: `حداقل مقدار ${field.min} است.` };
      }
      if (field.max !== undefined && number > field.max) {
        return { ok: false, error: `حداکثر مقدار ${field.max} است.` };
      }
      return { ok: true, value: number };
    }
    case "url": {
      if (!isValidUrl(value)) return { ok: false, error: "لینک معتبر نیست (https://...)." };
      return { ok: true, value };
    }
    case "telegram_target": {
      const target = parseChatTarget(value);
      if (!target) {
        return { ok: false, error: "مقصد معتبر نیست. مثال: @mychannel یا -1001234567890" };
      }
      return { ok: true, value: target };
    }
    case "buttons": {
      const parsed = parseButtons(value);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      return { ok: true, value: parsed.buttons };
    }
    case "schedule": {
      const parsed = parseScheduleInput(value, {
        timeZone: context.timeZone,
        now: context.now,
      });
      if (!parsed.ok) return { ok: false, error: parsed.error };
      return { ok: true, value: parsed.date.toISOString() };
    }
    case "choice": {
      const choices = field.choices ?? [];
      const normalized = normalizeDigits(value).trim();
      if (choices.length === 0) return { ok: false, error: "گزینه‌ای تعریف نشده است." };

      const byValue = choices.find((c) => c.value === normalized);
      if (byValue) return { ok: true, value: byValue.value };

      const byLabel = choices.find((c) => c.label === normalized);
      if (byLabel) return { ok: true, value: byLabel.value };

      const index = Number(normalized);
      if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
        const choice = choices[index - 1];
        return { ok: true, value: choice.value };
      }
      return {
        ok: false,
        error: `یکی از گزینه‌ها را انتخاب کنید: ${choices.map((c) => c.label).join(" | ")}`,
      };
    }
    default:
      return { ok: false, error: "نوع فیلد پشتیبانی نمی‌شود." };
  }
}

export interface WizardStepResult {
  ok: boolean;
  state: WizardState;
  done: boolean;
  error?: string;
  field?: WizardField;
}

function advance(
  definition: WizardDefinition,
  state: WizardState,
  key: string,
  value: unknown,
): WizardStepResult {
  const next: WizardState = {
    wizard: state.wizard,
    index: state.index + 1,
    data: { ...state.data, [key]: value },
  };
  return { ok: true, state: next, done: isWizardComplete(definition, next) };
}

export function applyWizardInput(
  definition: WizardDefinition,
  state: WizardState,
  raw: string,
  context: WizardContext,
): WizardStepResult {
  const field = currentField(definition, state);
  if (!field) return { ok: true, state, done: true };

  if (raw.trim() === WIZARD_SKIP) {
    return skipWizardField(definition, state);
  }

  const validation = validateWizardField(field, raw, context);
  if (!validation.ok) {
    return { ok: false, state, done: false, error: validation.error, field };
  }
  return advance(definition, state, field.key, validation.value);
}

export function skipWizardField(
  definition: WizardDefinition,
  state: WizardState,
): WizardStepResult {
  const field = currentField(definition, state);
  if (!field) return { ok: true, state, done: true };
  if (field.required !== false) {
    return {
      ok: false,
      state,
      done: false,
      error: "این مرحله اجباری است و قابل رد کردن نیست.",
      field,
    };
  }
  return advance(definition, state, field.key, null);
}

export function applyWizardChoice(
  definition: WizardDefinition,
  state: WizardState,
  choiceValue: string,
): WizardStepResult {
  const field = currentField(definition, state);
  if (!field) return { ok: true, state, done: true };
  if (field.kind !== "choice") {
    return { ok: false, state, done: false, error: "این مرحله انتخابی نیست.", field };
  }
  const choices = field.choices ?? [];
  const normalized = normalizeDigits(choiceValue).trim();
  const match = choices.find((c) => c.value === normalized) ??
    choices.find((c) => c.label === choiceValue.trim()) ??
    (() => {
      const index = Number(normalized);
      return Number.isInteger(index) && index >= 1 && index <= choices.length
        ? choices[index - 1]
        : undefined;
    })();
  if (!match) {
    return { ok: false, state, done: false, error: "گزینه نامعتبر است.", field };
  }
  return advance(definition, state, field.key, match.value);
}

export function goBackWizard(
  definition: WizardDefinition,
  state: WizardState,
): WizardState {
  if (state.index === 0) return state;
  const data = { ...state.data };
  const previous = definition.fields[state.index - 1];
  if (previous) delete data[previous.key];
  return { ...state, index: state.index - 1, data };
}

export function wizardPrimaryKeyboard(
  field: WizardField | undefined,
  options: { allowBack: boolean },
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];
  if (field?.kind === "choice" && field.choices) {
    for (let i = 0; i < field.choices.length; i += 2) {
      rows.push(
        field.choices.slice(i, i + 2).map((choice) => ({
          text: choice.label,
          callback_data: `w:c:${choice.value}`,
        })),
      );
    }
  }
  const controls: { text: string; callback_data: string }[] = [];
  if (field?.required === false) controls.push({ text: "⏭ رد کردن", callback_data: "w:s" });
  if (options.allowBack) controls.push({ text: "◀️ مرحله قبل", callback_data: "w:b" });
  controls.push({ text: "❌ انصراف", callback_data: "w:x" });
  rows.push(controls);
  return rows;
}
