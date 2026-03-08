import { z } from "zod";
import { appConfig } from "@/lib/config";
import type { NormalizedMarket } from "@/lib/types";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

function toBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

const aiResponseSchema = z
  .object({
    resolution_window_min_minutes: z.coerce.number().nonnegative(),
    resolution_window_max_minutes: z.coerce.number().nonnegative(),
    confidence: z
      .string()
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.enum(["low", "medium", "high"])),
    tradeable: z.union([z.boolean(), z.string()]),
    reason: z.string()
  })
  .transform((payload) => ({
    ...payload,
    resolution_window_min_minutes: Math.round(payload.resolution_window_min_minutes),
    resolution_window_max_minutes: Math.round(payload.resolution_window_max_minutes),
    tradeable: toBoolean(payload.tradeable) ?? false
  }))
  .refine(
    (payload) => payload.resolution_window_max_minutes >= payload.resolution_window_min_minutes,
    { message: "resolution_window_max_minutes must be >= resolution_window_min_minutes" }
  );

type AIResponse = z.infer<typeof aiResponseSchema>;

export type MarketSignal = {
  resolutionWindowMin: number;
  resolutionWindowMax: number;
  confidence: "low" | "medium" | "high";
  tradeable: boolean;
  reason: string;
};

function normalizeProbability(value: number | null) {
  if (value === null) {
    return null;
  }

  return value > 1 ? value / 100 : value;
}

function toWordsLimit(input: string, maxWords: number) {
  const words = input.trim().split(/\s+/);
  if (words.length <= maxWords) {
    return input.trim();
  }
  return words.slice(0, maxWords).join(" ");
}

function inferMarketType(title: string) {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("spread")) {
    return "spread";
  }
  if (
    normalizedTitle.includes("o/u") ||
    normalizedTitle.includes("over/under") ||
    normalizedTitle.includes("total")
  ) {
    return "totals";
  }
  if (
    normalizedTitle.includes("moneyline") ||
    normalizedTitle.includes("winner") ||
    normalizedTitle.includes("to win")
  ) {
    return "moneyline";
  }

  return "binary";
}

function buildPrompt(market: NormalizedMarket): string {
  const yesPrice = normalizeProbability(market.yesPrice);
  const noPrice = normalizeProbability(market.noPrice);
  const spread = yesPrice !== null && noPrice !== null
    ? Number(Math.abs(yesPrice - noPrice).toFixed(4))
    : null;
  const payload = {
    title: market.title,
    sport: market.category ?? "unknown",
    market_type: inferMarketType(market.title),
    start_time: market.closeTime,
    is_live: market.isLive ?? false,
    yes_price: yesPrice,
    no_price: noPrice,
    spread,
    volume: market.volume
  };

  return [
    "Analyze this near-resolution prediction market signal.",
    "Return STRICT JSON ONLY. No markdown. No explanation outside JSON.",
    "",
    "Input:",
    JSON.stringify(payload, null, 2),
    "",
    "Output JSON schema:",
    "{",
    '  "resolution_window_min_minutes": number,',
    '  "resolution_window_max_minutes": number,',
    '  "confidence": "low" | "medium" | "high",',
    '  "tradeable": boolean,',
    '  "reason": "string"',
    "}",
    "",
    "Rules:",
    "- resolution_window_* are minutes FROM EVENT START TIME and must be an interval.",
    "- Example: if likely conclusion is ~95 minutes after start, return around 80-110.",
    "- resolution_window_max_minutes must be >= resolution_window_min_minutes.",
    "- Keep reason under 25 words.",
    "- If too uncertain to trade, set tradeable=false."
  ].join("\n");
}

function extractCandidateJson(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  return trimmed.slice(first, last + 1);
}

async function callGroqRaw(prompt: string): Promise<string> {
  const apiKey = appConfig.groqApiKey;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are a prediction market analyst AI. Respond with JSON only and follow the user's schema exactly."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: {
        type: "json_object"
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

function parseAIResponse(content: string): AIResponse {
  const candidate = extractCandidateJson(content);

  if (!candidate) {
    throw new Error("No JSON found in Groq response");
  }

  return aiResponseSchema.parse(JSON.parse(candidate));
}

async function callGroq(prompt: string): Promise<AIResponse> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await callGroqRaw(prompt);
      return parseAIResponse(content);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Groq response parse failed");
}

export async function analyzeMarketWithAI(market: NormalizedMarket): Promise<MarketSignal | null> {
  const prompt = buildPrompt(market);

  try {
    const response = await callGroq(prompt);

    if (!response) {
      return null;
    }

    return {
      resolutionWindowMin: response.resolution_window_min_minutes,
      resolutionWindowMax: response.resolution_window_max_minutes,
      confidence: response.confidence,
      tradeable: response.tradeable,
      reason: toWordsLimit(response.reason, 25)
    };
  } catch (error) {
    console.error(`AI analysis failed for market ${market.id}:`, error);
    return null;
  }
}
