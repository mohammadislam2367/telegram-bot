/** Supabase (PostgREST) access helpers — service role only. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.ts";

export class DbError extends Error {
  readonly detail: string | undefined;
  readonly code: string | undefined;

  constructor(message: string, detail?: string, code?: string) {
    super(message);
    this.name = "DbError";
    this.detail = detail;
    this.code = code;
  }
}

let client: SupabaseClient | null = null;
let clientSignature = "";

export function getSupabase(
  cfg: Pick<AppConfig, "supabaseUrl" | "serviceRoleKey">,
): SupabaseClient {
  const signature = `${cfg.supabaseUrl}:${cfg.serviceRoleKey.slice(-8)}`;
  if (!client || clientSignature !== signature) {
    client = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "anime-click-ultimate/1.0" } },
    });
    clientSignature = signature;
  }
  return client;
}

type Query = {
  // supabase-js builders are highly generic; the helpers below are typed at the call site.
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
};

export interface DbResult<T> {
  data: T | null;
  error: { message: string; details?: string; hint?: string; code?: string } | null;
  count?: number | null;
}

function throwIfError(context: string, error: DbResult<unknown>["error"]): void {
  if (!error) return;
  throw new DbError(
    `${context}: ${error.message}`,
    error.details ?? error.hint ?? undefined,
    error.code,
  );
}

export async function selectRows<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  configure?: (query: Query) => Query,
): Promise<T[]> {
  // deno-lint-ignore no-explicit-any
  let query: any = (sb as any).from(table).select("*");
  if (configure) query = configure(query);
  const result = (await query) as DbResult<T[]>;
  throwIfError(`select ${table}`, result.error);
  return result.data ?? [];
}

export async function selectOne<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  configure?: (query: Query) => Query,
): Promise<T | null> {
  const rows = await selectRows<T>(sb, table, (query) => {
    const filtered = configure ? configure(query) : query;
    return filtered.limit(1);
  });
  return rows[0] ?? null;
}

export async function insertRow<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  values: Record<string, unknown>,
): Promise<T> {
  const result =
    (await (sb as unknown as Query).from(table).insert(values).select().single()) as DbResult<T>;
  throwIfError(`insert ${table}`, result.error);
  return result.data as T;
}

export async function insertRows<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  values: Record<string, unknown>[],
): Promise<T[]> {
  if (values.length === 0) return [];
  const result = (await (sb as unknown as Query).from(table).insert(values).select()) as DbResult<
    T[]
  >;
  throwIfError(`insert ${table}`, result.error);
  return result.data ?? [];
}

export async function updateRows<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  values: Record<string, unknown>,
  match: Record<string, unknown>,
): Promise<T[]> {
  // deno-lint-ignore no-explicit-any
  let query: any = (sb as any).from(table).update(values);
  for (const [column, value] of Object.entries(match)) {
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const result = (await query.select()) as DbResult<T[]>;
  throwIfError(`update ${table}`, result.error);
  return result.data ?? [];
}

export async function upsertRow<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  values: Record<string, unknown>,
  onConflict?: string,
): Promise<T> {
  // deno-lint-ignore no-explicit-any
  let query: any = (sb as any).from(table).upsert(values, onConflict ? { onConflict } : undefined);
  query = query.select().single();
  const result = (await query) as DbResult<T>;
  throwIfError(`upsert ${table}`, result.error);
  return result.data as T;
}

export async function deleteRows(
  sb: SupabaseClient,
  table: string,
  match: Record<string, unknown>,
): Promise<number> {
  // deno-lint-ignore no-explicit-any
  let query: any = (sb as any).from(table).delete();
  for (const [column, value] of Object.entries(match)) {
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const result = (await query.select()) as DbResult<Record<string, unknown>[]>;
  throwIfError(`delete ${table}`, result.error);
  return result.data?.length ?? 0;
}

export async function countRows(
  sb: SupabaseClient,
  table: string,
  configure?: (query: Query) => Query,
): Promise<number> {
  // deno-lint-ignore no-explicit-any
  let query: any = (sb as any).from(table).select("*", { count: "exact", head: true });
  if (configure) query = configure(query);
  const result = (await query) as DbResult<unknown>;
  throwIfError(`count ${table}`, result.error);
  return result.count ?? 0;
}

export async function callRpc<T = unknown>(
  sb: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = (await (sb as unknown as Query).rpc(fn, args)) as DbResult<T>;
  throwIfError(`rpc ${fn}`, result.error);
  return result.data as T;
}

/** پینگ دیتابیس برای health check. */
export async function pingDatabase(sb: SupabaseClient): Promise<boolean> {
  const result = (await (sb as unknown as Query)
    .from("bot_settings")
    .select("key", { count: "exact", head: true })) as DbResult<unknown>;
  return !result.error;
}
