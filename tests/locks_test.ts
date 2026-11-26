import { assertEquals } from "@std/assert";
import {
  buildPermissions,
  detectContentLock,
  hasPermissionLocks,
  normalizeLocks,
} from "../supabase/functions/telegram-bot/locks.ts";
import type { TgMessage } from "../supabase/functions/_shared/types.ts";

function message(partial: Partial<TgMessage>): TgMessage {
  return {
    message_id: 1,
    date: 0,
    chat: { id: -100, type: "supergroup" },
    ...partial,
  } as TgMessage;
}

Deno.test("normalizeLocks keeps only known true flags", () => {
  assertEquals(normalizeLocks({ link: true, photo: true, nope: true, video: false }), {
    link: true,
    photo: true,
  });
  assertEquals(normalizeLocks(null), {});
  assertEquals(normalizeLocks([1, 2]), {});
  assertEquals(normalizeLocks("link"), {});
});

Deno.test("buildPermissions maps locks to telegram permissions", () => {
  const permissions = buildPermissions({ photo: true, video: true, file: true });
  assertEquals(permissions.can_send_photos, false);
  assertEquals(permissions.can_send_videos, false);
  assertEquals(permissions.can_send_documents, false);
  assertEquals(permissions.can_send_messages, true);
});

Deno.test("all-lock closes every permission", () => {
  const permissions = buildPermissions({ all: true, photo: true });
  for (const value of Object.values(permissions)) assertEquals(value, false);
  assertEquals(hasPermissionLocks({ all: true }), true);
  assertEquals(hasPermissionLocks({ link: true, curse: true }), false);
});

Deno.test("content locks detect links, mentions, hashtags and curse words", () => {
  const locks = normalizeLocks({ link: true, username: true, hashtag: true, curse: true });

  assertEquals(
    detectContentLock(message({ text: "ببین https://example.com" }), locks)?.key,
    "link",
  );
  assertEquals(detectContentLock(message({ text: "سلام @someone_here" }), locks)?.key, "username");
  assertEquals(detectContentLock(message({ text: "امروز #انیمه دیدم" }), locks)?.key, "hashtag");
  assertEquals(detectContentLock(message({ text: "این کصکش رو ببین" }), locks)?.key, "curse");
  assertEquals(detectContentLock(message({ text: "سلام خوبی" }), locks), null);
});

Deno.test("content locks stay quiet when nothing is locked", () => {
  assertEquals(detectContentLock(message({ text: "https://example.com" }), {}), null);
});

Deno.test("forward, long and english locks work", () => {
  const forward = normalizeLocks({ forward: true });
  assertEquals(detectContentLock(message({ text: "x", forward_date: 1 }), forward)?.key, "forward");
  const automatic = message({ text: "x", forward_date: 1, is_automatic_forward: true });
  assertEquals(detectContentLock(automatic, forward), null);

  const long = normalizeLocks({ long: true });
  assertEquals(detectContentLock(message({ text: "ا".repeat(800) }), long)?.key, "long");
  assertEquals(detectContentLock(message({ text: "ا".repeat(700) }), long), null);

  const english = normalizeLocks({ english: true });
  assertEquals(detectContentLock(message({ text: "hello world" }), english)?.key, "english");
  assertEquals(detectContentLock(message({ text: "سلام دنیا" }), english), null);
});
