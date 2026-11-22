/** HTTP helpers: timeout, single retry policy, structured errors. */

export interface JsonResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * fetch با timeout قطعی و محدودیت اندازه‌ی بدنه.
 * خطای شبکه/تایم‌اوت به HttpError تبدیل نمی‌شود تا caller بتواند تصمیم بگیرد.
 */
export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<JsonResponse<T>> {
  const { timeoutMs = 15_000, method = "GET", headers = {}, body } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...headers },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      throw new HttpError(
        `HTTP ${res.status} برای ${new URL(url).host}`,
        res.status,
        text.slice(0, 2000),
      );
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
