import { z } from "zod"
import { askJson } from "@/ai/json"
import { type Categorisable, groupForCategorisation } from "@/domain/rules"

/**
 * Categorising what the rules could not.
 *
 * Transactions are grouped by payee first, so one question covers every
 * purchase at the same shop, and the model is given the user's own category
 * list — never a taxonomy of its own. It may answer `null`, and it is told
 * plainly that `null` is a better answer than a guess: an unexplained line is
 * visible and fixable, a confidently wrong one is neither.
 */

const decision = z.object({
  group: z.string(),
  categoryId: z.string().nullable(),
  confidence: z.number().min(0).max(100),
  reason: z.string().max(200),
  /** Whether this looks like a committed monthly cost rather than a choice —
   * the fixed-cost share metric needs it and no rule can infer it. */
  fixedCost: z.boolean().optional(),
})

const response = z.object({ decisions: z.array(decision) })

export type CategoryChoice = { id: string; name: string; kind: string; group: string | null }

export type Categorisation = {
  txnIds: string[]
  categoryId: string | null
  confidence: number
  reason: string
  fixedCost: boolean
}

export function buildCategorisePrompt(
  groups: ReadonlyMap<string, readonly (Categorisable & { amountCents: number })[]>,
  categories: readonly CategoryChoice[],
): string {
  const catalogue = categories
    .map((c) => `- ${c.id} :: ${c.name} (${c.kind}${c.group ? `, in ${c.group}` : ""})`)
    .join("\n")

  const samples = [...groups.entries()]
    .map(([key, txns]) => {
      const examples = txns
        .slice(0, 3)
        .map((t) => `"${`${t.counterparty ?? ""} ${t.description}`.trim()}" ${(t.amountCents / 100).toFixed(2)}`)
        .join(" | ")
      return `- group "${key}" (${txns.length} transaction${txns.length === 1 ? "" : "s"}): ${examples}`
    })
    .join("\n")

  return [
    "Assign each group of bank transactions to one of the user's own categories.",
    "",
    "Categories available (use the id exactly, never invent one):",
    catalogue || "(none — return null for every group)",
    "",
    "Groups to categorise:",
    samples,
    "",
    'Answer as {"decisions":[{"group":"...","categoryId":"..."|null,"confidence":0-100,"reason":"short","fixedCost":true|false}]}.',
    "Return categoryId null when no category genuinely fits. An honest null is worth more than a confident guess, because the user sees nulls and fixes them.",
    "fixedCost is true only for committed recurring obligations — rent, insurance, loan payments, subscriptions — not for groceries or shopping.",
  ].join("\n")
}

export async function categorise<T extends Categorisable & { id: string; amountCents: number }>(
  txns: readonly T[],
  categories: readonly CategoryChoice[],
  signal?: AbortSignal,
): Promise<Categorisation[]> {
  if (txns.length === 0 || categories.length === 0) return []

  const groups = groupForCategorisation(txns)
  const validIds = new Set(categories.map((c) => c.id))

  const answer = await askJson(buildCategorisePrompt(groups, categories), response, {
    lane: "kompass-fast",
    maxTokens: 4096,
    system:
      "You categorise bank transactions for a personal finance app. You are precise, you never invent a category id, and you say null when unsure.",
    signal,
  })

  const out: Categorisation[] = []

  for (const decision of answer.decisions) {
    const bucket = groups.get(decision.group)
    if (!bucket) continue
    // A hallucinated id is treated as "no answer" rather than dropped
    // silently: the transactions stay unexplained and visible.
    const categoryId =
      decision.categoryId && validIds.has(decision.categoryId) ? decision.categoryId : null

    out.push({
      txnIds: bucket.map((txn) => txn.id),
      categoryId,
      confidence: categoryId ? Math.round(decision.confidence) : 0,
      reason: decision.reason,
      fixedCost: decision.fixedCost ?? false,
    })
  }

  return out
}
