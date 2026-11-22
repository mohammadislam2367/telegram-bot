import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  splitMessage,
  TelegramApi,
  TelegramError,
} from "../supabase/functions/_shared/telegram.ts";

Deno.test("splitMessage keeps chunks under the Telegram limit", () => {
  const text = Array.from({ length: 500 }, (_, i) => `خط ${i} توضیح طولانی برای تست`).join("\n");
  const chunks = splitMessage(text, 1000);
  assert(chunks.length > 1);
  for (const chunk of chunks) assert(chunk.length <= 1000, `len=${chunk.length}`);
  assertEquals(chunks.join("\n").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

function withFetch(
  handler: (
    url: string,
    init: RequestInit | undefined,
    attempt: number,
  ) => Promise<Response> | Response,
  run: (attempts: () => number) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    attempts++;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url, init, attempts));
  }) as typeof fetch;

  return run(() => attempts).finally(() => {
    globalThis.fetch = original;
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("TelegramApi sends HTML-formatted messages", async () => {
  await withFetch(
    (url, init) => {
      assert(url.includes("/botTEST_TOKEN/sendMessage"));
      const payload = JSON.parse(String(init?.body ?? "{}"));
      assertEquals(payload.chat_id, 123);
      assertEquals(payload.parse_mode, "HTML");
      assertEquals(payload.text, "سلام");
      assertEquals(payload.link_preview_options, { is_disabled: true });
      return json({ ok: true, result: { message_id: 42 } });
    },
    async () => {
      const api = new TelegramApi("TEST_TOKEN", { apiBase: "https://api.test" });
      const message = await api.sendMessage(123, "سلام");
      assertEquals(message.message_id, 42);
    },
  );
});

Deno.test("TelegramApi retries 429 with retry_after", async () => {
  await withFetch(
    (_url, _init, attempt) => {
      if (attempt === 1) {
        return json({
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 0",
          parameters: { retry_after: 0 },
        }, 429);
      }
      return json({ ok: true, result: { message_id: 7 } });
    },
    async (attempts) => {
      const api = new TelegramApi("TEST_TOKEN", { apiBase: "https://api.test", maxRetries: 2 });
      const message = await api.sendMessage(1, "test");
      assertEquals(message.message_id, 7);
      assertEquals(attempts(), 2);
    },
  );
});

Deno.test("TelegramApi classifies blocked users and not-modified errors", async () => {
  await withFetch(
    () =>
      json(
        { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
        403,
      ),
    async () => {
      const api = new TelegramApi("TEST_TOKEN", { apiBase: "https://api.test", maxRetries: 0 });
      const error = await assertRejects(() => api.sendMessage(1, "test"), TelegramError);
      assertEquals(error.isUserUnreachable, true);
      assertEquals(error.code, 403);
    },
  );

  await withFetch(
    () =>
      json(
        { ok: false, error_code: 400, description: "Bad Request: message is not modified" },
        400,
      ),
    async () => {
      const api = new TelegramApi("TEST_TOKEN", { apiBase: "https://api.test", maxRetries: 0 });
      const error = await assertRejects(
        () => api.editMessageText(1, 2, "same"),
        TelegramError,
      );
      assertEquals(error.isNotModified, true);
    },
  );
});

Deno.test("TelegramApi never exposes the token in errors", async () => {
  await withFetch(
    () => json({ ok: false, error_code: 401, description: "Unauthorized" }, 401),
    async () => {
      const api = new TelegramApi("SUPER_SECRET_TOKEN", {
        apiBase: "https://api.test",
        maxRetries: 0,
      });
      const error = await assertRejects(() => api.getMe(), TelegramError);
      assertEquals(error.message.includes("SUPER_SECRET_TOKEN"), false);
    },
  );
});
