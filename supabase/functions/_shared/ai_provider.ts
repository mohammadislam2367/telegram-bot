/**
 * Gemini provider (REST, مستقل از منطق ربات).
 * تنها این فایل با سرویس هوش مصنوعی صحبت می‌کند تا تعویض provider ساده بماند.
 */
import { fetchJson, HttpError, sleep } from "./http.ts";

export interface GeminiTurn {
  role: "user" | "model";
  text: string;
}

export interface GeminiRequest {
  apiKey: string;
  model: string;
  persona: string;
  prompt: string;
  history?: GeminiTurn[];
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
  maxRetries?: number;
  apiBase?: string;
}

export interface GeminiResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  finishReason: string;
}

export class AiProviderError extends Error {
  readonly status: number;
  readonly code: string;
  readonly quota: boolean;
  readonly retryable: boolean;

  constructor(message: string, options: {
    status?: number;
    code?: string;
    quota?: boolean;
    retryable?: boolean;
  } = {}) {
    super(message);
    this.name = "AiProviderError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "unknown";
    this.quota = options.quota ?? false;
    this.retryable = options.retryable ?? false;
  }
}

export function isGeminiConfigured(apiKey: string | undefined | null): boolean {
  return typeof apiKey === "string" && apiKey.trim().length > 10;
}

interface GeminiResponseBody {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

function classify(status: number, body: string): AiProviderError {
  const lower = body.toLowerCase();
  const quota = status === 429 ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("rate limit");
  const retryable = status >= 500 || status === 408;
  return new AiProviderError(
    `Gemini HTTP ${status}: ${body.slice(0, 300)}`,
    { status, code: status === 429 ? "rate_limited" : "http_error", quota, retryable },
  );
}

export async function generateContent(request: GeminiRequest): Promise<GeminiResult> {
  const startedAt = Date.now();
  const model = request.model.trim() || "gemini-2.0-flash";
  const apiBase = request.apiBase ?? "https://generativelanguage.googleapis.com/v1beta";
  const maxRetries = Math.min(Math.max(request.maxRetries ?? 1, 0), 3);

  const contents = [
    ...(request.history ?? []).map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    { role: "user", parts: [{ text: request.prompt }] },
  ];

  const payload = {
    systemInstruction: { parts: [{ text: request.persona }] },
    contents,
    generationConfig: {
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxOutputTokens ?? 800,
      topP: 0.95,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  const url = `${apiBase}/models/${encodeURIComponent(model)}:generateContent`;

  let lastError: AiProviderError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchJson<GeminiResponseBody>(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": request.apiKey,
        },
        body: JSON.stringify(payload),
        timeoutMs: request.timeoutMs ?? 20_000,
      });

      const body = response.body;
      const text = (body.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!text) {
        const blockReason = body.promptFeedback?.blockReason;
        throw new AiProviderError(
          blockReason
            ? `پاسخ توسط فیلتر ایمنی مسدود شد (${blockReason}).`
            : "پاسخ خالی از سرویس هوش مصنوعی دریافت شد.",
          { status: response.status, code: blockReason ? "blocked" : "empty_response" },
        );
      }

      return {
        text,
        model,
        promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - startedAt,
        finishReason: body.candidates?.[0]?.finishReason ?? "STOP",
      };
    } catch (error) {
      if (error instanceof HttpError) {
        lastError = classify(error.status, error.body);
      } else if (error instanceof AiProviderError) {
        lastError = error;
      } else {
        lastError = new AiProviderError(
          `خطای شبکه در تماس با Gemini: ${(error as Error).message}`,
          { code: "network", retryable: true },
        );
      }

      if (lastError.retryable && attempt < maxRetries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new AiProviderError("Gemini در دسترس نیست", { code: "unavailable" });
}
