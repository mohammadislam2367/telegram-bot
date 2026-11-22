/** Multi-step sessions stored in DB (Edge Functions are stateless). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteRows, selectOne, upsertRow } from "./db.ts";
import type { SessionRow } from "./types.ts";

export async function getSession(
  sb: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<SessionRow | null> {
  const row = await selectOne<SessionRow>(
    sb,
    "bot_sessions",
    (q) => q.eq("telegram_id", telegramId).eq("chat_id", chatId),
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await clearSession(sb, telegramId, chatId);
    return null;
  }
  return row;
}

export async function startSession(
  sb: SupabaseClient,
  telegramId: number,
  chatId: number,
  state: string,
  payload: Record<string, unknown>,
  ttlMinutes: number,
): Promise<SessionRow> {
  return await upsertRow<SessionRow>(
    sb,
    "bot_sessions",
    {
      telegram_id: telegramId,
      chat_id: chatId,
      state,
      payload,
      expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    "telegram_id,chat_id",
  );
}

export async function saveSession(
  sb: SupabaseClient,
  session: Pick<SessionRow, "telegram_id" | "chat_id" | "state" | "payload">,
  ttlMinutes: number,
): Promise<void> {
  await startSession(
    sb,
    session.telegram_id,
    session.chat_id,
    session.state,
    session.payload,
    ttlMinutes,
  );
}

export async function clearSession(
  sb: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  try {
    await deleteRows(sb, "bot_sessions", { telegram_id: telegramId, chat_id: chatId });
  } catch (error) {
    console.warn("clearSession failed:", (error as Error).message);
  }
}

export function isSessionExpired(row: Pick<SessionRow, "expires_at">, now = Date.now()): boolean {
  return new Date(row.expires_at).getTime() <= now;
}

/** حذف sessionهای منقضی و برگرداندن تعداد. */
export async function deleteExpiredSessions(
  sb: SupabaseClient,
  now = new Date(),
): Promise<number> {
  const result = await (sb as unknown as {
    from: (table: string) => {
      delete: (options: { count: "exact" }) => {
        lt: (column: string, value: string) => Promise<{ count: number | null; error: unknown }>;
      };
    };
  })
    .from("bot_sessions")
    .delete({ count: "exact" })
    .lt("expires_at", now.toISOString());
  if (result.error) {
    console.warn("deleteExpiredSessions failed");
    return 0;
  }
  return result.count ?? 0;
}
