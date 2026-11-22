import { assert, assertEquals } from "@std/assert";
import {
  ADMIN_MENU_SECTIONS,
  adminMainKeyboard,
  backRow,
  button,
  confirmKeyboard,
  keyboard,
  paginationRow,
  toggleButton,
  urlButton,
  userMainKeyboard,
} from "../supabase/functions/_shared/keyboards.ts";
import { buildAdminIdentity } from "../supabase/functions/_shared/auth.ts";
import { isValidCallbackData } from "../supabase/functions/_shared/validation.ts";

const owner = buildAdminIdentity({ userId: 1, isSuperAdmin: true, row: null })!;
const moderator = buildAdminIdentity({
  userId: 2,
  isSuperAdmin: false,
  row: { role: "moderator", permissions: [], is_active: true },
})!;

Deno.test("admin menu exposes all 13 dashboard sections for the owner", () => {
  const markup = adminMainKeyboard(owner);
  const callbacks = markup.inline_keyboard.flat().map((item) => item.callback_data ?? "");
  for (const section of ADMIN_MENU_SECTIONS) {
    assert(callbacks.includes(section.callbackData), section.callbackData);
  }
  assertEquals(ADMIN_MENU_SECTIONS.length, 13);
  assertEquals(callbacks.includes("a:me"), true);
});

Deno.test("admin menu filters sections by permission", () => {
  const markup = adminMainKeyboard(moderator);
  const callbacks = markup.inline_keyboard.flat().map((item) => item.callback_data ?? "");
  assert(callbacks.includes("a:st"));
  assert(callbacks.includes("a:us"));
  assert(callbacks.includes("a:gr"));
  assertEquals(callbacks.includes("a:se"), false);
  assertEquals(callbacks.includes("a:tl"), false);
});

Deno.test("admin menu respects disabled features", () => {
  const markup = adminMainKeyboard(owner, { ai: false, ads: false });
  const callbacks = markup.inline_keyboard.flat().map((item) => item.callback_data ?? "");
  assertEquals(callbacks.includes("a:ai"), false);
  assertEquals(callbacks.includes("a:ad"), false);
  assert(callbacks.includes("a:st"));
});

Deno.test("every generated callback fits Telegram's 64-byte limit", () => {
  const markup = adminMainKeyboard(owner);
  for (const item of markup.inline_keyboard.flat()) {
    if (item.callback_data) {
      assert(isValidCallbackData(item.callback_data), item.callback_data);
    }
  }
  const page = paginationRow("a:ad:f:active", 12, true);
  for (const item of page) {
    if (item.callback_data) assert(isValidCallbackData(item.callback_data));
  }
});

Deno.test("user keyboard hides features and adds urls", () => {
  const markup = userMainKeyboard({
    channelUrl: "https://t.me/clickanime128",
    supportUrl: "https://t.me/Spixle_bot",
    showAi: false,
    showAnime: true,
    showNews: true,
  });
  const items = markup.inline_keyboard.flat();
  const callbacks = items.map((item) => item.callback_data ?? "");
  const urls = items.map((item) => item.url ?? "");
  assertEquals(callbacks.includes("u:ai"), false);
  assert(callbacks.includes("u:an"));
  assert(urls.includes("https://t.me/clickanime128"));
  assert(urls.includes("https://t.me/Spixle_bot"));
});

Deno.test("keyboard helpers produce well-formed rows", () => {
  const markup = keyboard([[button("بله", "x:y:1"), button("خیر", "x:n:1")], []]);
  assertEquals(markup.inline_keyboard.length, 1);
  assertEquals(markup.inline_keyboard[0].length, 2);

  const confirm = confirmKeyboard("x:y:t", "x:n:t");
  assertEquals(confirm.inline_keyboard.length, 2);

  const toggle = toggleButton("ضدلینک", true, "a:g:1:t:antilink_enabled");
  assertEquals(toggle.text.includes("🟢"), true);

  const back = backRow("a:us");
  assertEquals(back[0].callback_data, "a:us");

  const url = urlButton("کانال", "https://t.me/x");
  assertEquals(url.url, "https://t.me/x");
});
