
/** Structured logging → console + public.system_logs. */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  context?: Record<string, unknown>;
  telegramUserId?: number;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): Promise<void>;
  info(message: string, context?: Record<string, unknown>): Promise<void>;
  warn(message: string, context?: Record<string, unknown>): Promise<void>;
  error(message: string, context?: Record<string, unknown>): Promise<void>;
  child(scope: string, telegramUserId?: number): Logger;
}

function safeContext(context?: Record<string, unknown>) {
  if (!context) return {};
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (/token|secret|key|password|authorization/i.test(key)) continue;
    result[key] = value instanceof Error ? value.message :
      typeof value === "string" && value.length > 500
        ? `${value.slice(0, 500)}…`
        : value;
  }

  return result;
}

export async function logToDb(
  sb: SupabaseClient,
  entry: LogEntry,
): Promise<void> {
  try {
    const { error } = await sb.from("system_logs").insert({
      level: entry.level,
      scope: entry.scope.slice(0, 100),
      message: entry.message.slice(0, 1000),
      context: safeContext(entry.context),
      telegram_user_id: entry.telegramUserId ?? null,
    });

    if (error) {
      console.warn(`[${entry.scope}] log persist failed: ${error.message}`);
    }
  } catch (error) {
    console.warn(`[${entry.scope}] log persist failed:`, error);
  }
}

export function createLogger(
  sb: SupabaseClient,
  scope: string,
  telegramUserId?: number,
): Logger {
  const write = async (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ) => {
    const safe = safeContext(context);

    if (level === "error") console.error(`[${scope}]`, message, safe);
    else if (level === "warn") console.warn(`[${scope}]`, message, safe);
    else console.log(`[${scope}]`, message, safe);

    await logToDb(sb, {
      level,
      scope,
      message,
      context: safe,
      telegramUserId,
    });
  };

  return {
    debug: (m, c) => write("debug", m, c),
    info: (m, c) => write("info", m, c),
    warn: (m, c) => write("warn", m, c),
    error: (m, c) => write("error", m, c),
    child: (s, id) =>
      createLogger(sb, `${scope}/${s}`, id ?? telegramUserId),
  };
}
