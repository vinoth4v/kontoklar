import type { z } from "zod"
import { ask, type Lane, type Message } from "@/kompass"

/**
 * Asking a model for structured data, and refusing to trust the answer.
 *
 * Every AI feature here validates against a Zod schema before a single value
 * reaches the database. The model is treated as an unreliable narrator with
 * good instincts — which is exactly what it is, and the alternative (parsing
 * hopefully, storing whatever came back) is how an app ends up with a category
 * called `undefined` and a €NaN budget line.
 *
 * One retry, with the validation error fed back. Beyond that the caller gets a
 * failure and the app carries on in manual mode: no screen in this app depends
 * on the model being available, which is a product decision as much as a
 * resilience one.
 */

export class AiUnavailable extends Error {}

export type AskJsonOptions = {
  lane?: Lane
  maxTokens?: number
  system?: string
  signal?: AbortSignal
}

const JSON_RULE =
  "Reply with JSON only. No prose before or after it, no markdown fence, no explanation. If you are unsure of a value, use the schema's allowance for uncertainty rather than inventing precision."

export async function askJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: AskJsonOptions = {},
): Promise<T> {
  const messages: Message[] = [{ role: "user", content: prompt }]

  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string
    try {
      const answer = await ask(messages, {
        lane: options.lane ?? "kompass-agentic",
        maxTokens: options.maxTokens ?? 4096,
        system: [options.system, JSON_RULE].filter(Boolean).join("\n\n"),
        signal: options.signal,
      })
      text = answer.text
    } catch (error) {
      throw new AiUnavailable(error instanceof Error ? error.message : String(error))
    }

    const candidate = extractJson(text)
    const parsed = candidate === null ? null : schema.safeParse(candidate)

    if (parsed?.success) return parsed.data

    if (attempt === 0) {
      messages.push({ role: "assistant", content: text.slice(0, 2000) })
      messages.push({
        role: "user",
        content: parsed
          ? `That did not match the required shape: ${parsed.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .slice(0, 8)
              .join("; ")}. Reply again with JSON only.`
          : "That was not valid JSON. Reply again with JSON only.",
      })
      continue
    }

    throw new AiUnavailable("The model did not return the requested shape after a retry.")
  }

  throw new AiUnavailable("unreachable")
}

/**
 * Find the JSON in a reply that may have ignored the instruction not to wrap
 * it. Fenced blocks first, then the outermost braces or brackets.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidates = [fenced?.[1], text, sliceOutermost(text, "{", "}"), sliceOutermost(text, "[", "]")]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate.trim())
    } catch {
      // try the next shape
    }
  }
  return null
}

function sliceOutermost(text: string, open: string, close: string): string | undefined {
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  if (start < 0 || end <= start) return undefined
  return text.slice(start, end + 1)
}

/** Whether the gateway is configured at all. Screens use this to offer AI
 * features only when they can actually run, rather than after a failure. */
export function aiConfigured(): boolean {
  return Boolean(process.env.KOMPASS_BASE_URL && process.env.KOMPASS_TOKEN)
}
