import { assertEquals } from "@std/assert";
import {
  buildPermissions,
  detectViolation,
  hasPermissionLocks,
  isPhishing,
  lockKey,
  normalizeLocks,
} from "../supabase/functions/telegram-bot/locks.ts";
import type { TgMessage } from "../supabase/functions/telegram-bot/core.ts";

function message(patch: Partial<TgMessage>): TgMessage {
  return {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "supergroup" },
    from: { id: 2, first_name: "Test" },
    ...patch,
  } as TgMessage;
}

Deno.test("normalizeLocks only keeps true flags", () => {
  assertEquals(normalizeLocks({ link: true, photo: false, nope: true }), { link: true });
  assertEquals(normalizeLocks(null), {});
});

Deno.test("buildPermissions locks everything for the global lock", () => {
  const all = buildPermissions({ all: true });
  assertEquals(Object.values(all).every((value) => value === false), true);
  const photo = buildPermissions({ photo: true });
  assertEquals(photo.can_send_photos, false);
  assertEquals(photo.can_send_messages, true);
});

Deno.test("hasPermissionLocks ignores content locks", () => {
  assertEquals(hasPermissionLocks({ link: true }), false);
  assertEquals(hasPermissionLocks({ sticker: true }), true);
});

Deno.test("detectViolation finds content locks", () => {
  assertEquals(
    detectViolation(message({ text: "ببین https://example.com" }), { link: true })?.key,
    "link",
  );
  assertEquals(
    detectViolation(message({ text: "سلام @someone_here" }), { username: true })?.key,
    "username",
  );
  assertEquals(
    detectViolation(message({ text: "این کصکش رو ببین" }), { curse: true })?.key,
    "curse",
  );
  assertEquals(detectViolation(message({ text: "سلام خوبی" }), { link: true }), null);
  assertEquals(detectViolation(message({ text: "من" }), {}), null);
});

Deno.test("lockKey understands Persian lock names", () => {
  assertEquals(lockKey("لینک"), "link");
  assertEquals(lockKey("عکس ها"), "photo");
  assertEquals(lockKey("دکمه شیشه ای"), "glass_button");
  assertEquals(lockKey("چیزی که نیست"), null);
});

Deno.test("isPhishing flags scam links only", () => {
  assertEquals(isPhishing("جایزه ۵۰ میلیونی: https://scam.example"), true);
  assertEquals(isPhishing("ورود از telegrom.ir"), true);
  assertEquals(isPhishing("سلام خوبی؟"), false);
  assertEquals(isPhishing("https://github.com/denoland/deno"), false);
});
