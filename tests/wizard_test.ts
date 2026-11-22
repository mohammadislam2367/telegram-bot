import { assert, assertEquals } from "@std/assert";
import {
  applyWizardChoice,
  applyWizardInput,
  currentField,
  goBackWizard,
  isWizardComplete,
  renderWizardPrompt,
  skipWizardField,
  startWizard,
  validateWizardField,
  type WizardDefinition,
  wizardProgress,
} from "../supabase/functions/_shared/wizard.ts";

const context = { timeZone: "Asia/Tehran", now: new Date("2026-03-21T10:00:00.000Z") };

const definition: WizardDefinition = {
  id: "test",
  title: "تست",
  fields: [
    { key: "title", label: "عنوان", prompt: "عنوان", kind: "text", minLength: 3, maxLength: 10 },
    {
      key: "kind",
      label: "نوع",
      prompt: "نوع",
      kind: "choice",
      choices: [
        { value: "none", label: "بدون" },
        { value: "photo", label: "عکس" },
      ],
    },
    { key: "count", label: "تعداد", prompt: "تعداد", kind: "int", min: 1, max: 5 },
    { key: "extra", label: "اختیاری", prompt: "اختیاری", kind: "text", required: false },
    { key: "when", label: "زمان", prompt: "زمان", kind: "schedule" },
  ],
  validate: (data) => (data.kind === "photo" && !data.extra ? "عکس نیاز به فایل دارد." : null),
};

Deno.test("wizard starts at the first field", () => {
  const state = startWizard(definition);
  assertEquals(state.index, 0);
  assertEquals(currentField(definition, state)?.key, "title");
  assertEquals(isWizardComplete(definition, state), false);
  assert(wizardProgress(definition, state).includes("۱"));
  assert(renderWizardPrompt(definition, state).includes("عنوان"));
});

Deno.test("wizard validates text length and stays on error", () => {
  const state = startWizard(definition);
  const tooShort = applyWizardInput(definition, state, "ab", context);
  assertEquals(tooShort.ok, false);
  assertEquals(tooShort.state.index, 0);

  const valid = applyWizardInput(definition, state, "سلام", context);
  assert(valid.ok);
  assertEquals(valid.state.index, 1);
  assertEquals(valid.state.data.title, "سلام");
});

Deno.test("wizard choice by value, label and index", () => {
  let state = startWizard(definition);
  state = applyWizardInput(definition, state, "سلام", context).state;

  const byValue = applyWizardChoice(definition, state, "photo");
  assert(byValue.ok);
  assertEquals(byValue.state.data.kind, "photo");

  const byLabel = applyWizardChoice(definition, state, "بدون");
  assert(byLabel.ok);
  assertEquals(byLabel.state.data.kind, "none");

  const byIndex = applyWizardChoice(definition, state, "2");
  assert(byIndex.ok);
  assertEquals(byIndex.state.data.kind, "photo");

  const invalid = applyWizardChoice(definition, state, "video");
  assertEquals(invalid.ok, false);
});

Deno.test("wizard integer bounds", () => {
  let state = startWizard(definition);
  state = applyWizardInput(definition, state, "سلام", context).state;
  state = applyWizardChoice(definition, state, "none").state;

  assertEquals(applyWizardInput(definition, state, "0", context).ok, false);
  assertEquals(applyWizardInput(definition, state, "9", context).ok, false);
  assertEquals(applyWizardInput(definition, state, "abc", context).ok, false);

  const valid = applyWizardInput(definition, state, "۳", context);
  assert(valid.ok);
  assertEquals(valid.state.data.count, 3);
});

Deno.test("optional fields can be skipped, required cannot", () => {
  let state = startWizard(definition);
  state = applyWizardInput(definition, state, "سلام", context).state;
  state = applyWizardChoice(definition, state, "none").state;
  state = applyWizardInput(definition, state, "2", context).state;

  const requiredSkip = skipWizardField(definition, { ...state, index: 0 });
  assertEquals(requiredSkip.ok, false);

  const skipped = skipWizardField(definition, state);
  assert(skipped.ok);
  assertEquals(skipped.state.data.extra, null);
  assertEquals(skipped.state.index, 4);

  const complete = applyWizardInput(definition, skipped.state, "2h", context);
  assert(complete.ok);
  assert(complete.done);
  assertEquals(typeof complete.state.data.when, "string");
});

Deno.test("wizard back removes the previous value", () => {
  let state = startWizard(definition);
  state = applyWizardInput(definition, state, "سلام", context).state;
  state = applyWizardChoice(definition, state, "none").state;

  const back = goBackWizard(definition, state);
  assertEquals(back.index, 1);
  assertEquals("kind" in back.data, false);
  assertEquals(back.data.title, "سلام");
});

Deno.test("field validation covers url, target and buttons", () => {
  assertEquals(
    validateWizardField({ key: "u", label: "u", prompt: "", kind: "url" }, "nope", context).ok,
    false,
  );
  assertEquals(
    validateWizardField({ key: "u", label: "u", prompt: "", kind: "url" }, "https://a.com", context)
      .ok,
    true,
  );
  assertEquals(
    validateWizardField(
      { key: "t", label: "t", prompt: "", kind: "telegram_target" },
      "@mychannel",
      context,
    ).ok,
    true,
  );
  assertEquals(
    validateWizardField(
      { key: "t", label: "t", prompt: "", kind: "telegram_target" },
      "bad",
      context,
    ).ok,
    false,
  );
  assertEquals(
    validateWizardField(
      { key: "b", label: "b", prompt: "", kind: "buttons" },
      "لینک | https://a.com",
      context,
    ).ok,
    true,
  );
});
