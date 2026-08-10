import { z } from "zod"
import { askJson } from "@/ai/json"
import { taxContextFor } from "@/domain/locale"
import type { RecurringCandidate } from "@/domain/rules"

/**
 * The part that is supposed to tell the truth about the gap.
 *
 * Everything here is given the same snapshot: what was planned, what happened,
 * what is recurring, what is unexplained. The instruction that matters most is
 * repeated in every prompt — rank by annual value and ignore the small stuff.
 * An advisor that opens with "you spent €13 on coffee" has trained the user to
 * close the tab, and the €2,400 duplicate insurance policy goes on being paid.
 *
 * Every output is stored and shown with the same disclaimer: this is
 * information about the user's own numbers, not regulated financial advice.
 */

export const DISCLAIMER =
  "Information about your own numbers, not regulated financial advice. Check anything consequential with a professional who is accountable for it."

const SYSTEM =
  "You analyse one person's real budget data. You are direct, specific, and quantitative. You rank by money per year, never by how easy something is to say. You never recommend a product, a broker or an investment. You say plainly when the data is too thin to support a conclusion, and you never present a guess as a finding."

export type Snapshot = {
  currency: string
  country: string
  month: string
  householdName: string
  /** Rendered plan-versus-actual, one line per category. */
  lines: { name: string; kind: string; plannedCents: number; actualCents: number; fixedCost: boolean }[]
  incomeCents: number
  expenseCents: number
  savingsCents: number
  unexplainedCents: number
  liquidCents: number
  monthsOfLiquidity: number | null
  history: { month: string; incomeCents: number; expenseCents: number }[]
  recurring: RecurringCandidate[]
}

function renderSnapshot(snapshot: Snapshot): string {
  const money = (cents: number) => `${(cents / 100).toFixed(2)} ${snapshot.currency}`

  return [
    `Household: ${snapshot.householdName}. Country: ${snapshot.country}. Month: ${snapshot.month}.`,
    `Income ${money(snapshot.incomeCents)}, spending ${money(snapshot.expenseCents)}, set aside ${money(snapshot.savingsCents)}, unexplained ${money(snapshot.unexplainedCents)}.`,
    `Liquid ${money(snapshot.liquidCents)}${snapshot.monthsOfLiquidity === null ? "" : `, about ${snapshot.monthsOfLiquidity.toFixed(1)} months of spending`}.`,
    "",
    "Plan versus actual this month:",
    ...snapshot.lines.map(
      (line) =>
        `- ${line.name} (${line.kind}${line.fixedCost ? ", fixed" : ""}): planned ${money(line.plannedCents)}, actual ${money(line.actualCents)}`,
    ),
    "",
    "Recent months:",
    ...snapshot.history.map(
      (month) => `- ${month.month}: income ${money(month.incomeCents)}, spending ${money(month.expenseCents)}`,
    ),
    "",
    snapshot.recurring.length > 0 ? "Recurring charges detected:" : "No recurring charges detected.",
    ...snapshot.recurring.map(
      (candidate) =>
        `- "${candidate.matcher}": ${candidate.occurrences}x, about ${money(candidate.averageCents)} every ${candidate.averageIntervalDays} days, last on ${candidate.lastSeen}`,
    ),
  ].join("\n")
}

const move = z.object({
  title: z.string().max(120),
  detail: z.string().max(900),
  annualImpactCents: z.number().int(),
  confidence: z.enum(["high", "medium", "low"]),
})

const analysis = z.object({
  verdict: z.string().max(700),
  moves: z.array(move).max(8),
  watch: z.array(z.string().max(240)).max(5),
})

export type Analysis = z.infer<typeof analysis>

export async function monthlyAnalysis(snapshot: Snapshot, signal?: AbortSignal): Promise<Analysis> {
  return askJson(
    [
      "Analyse this month and rank what to do about it.",
      "",
      renderSnapshot(snapshot),
      "",
      "Rules:",
      "- Rank every move by annualImpactCents, largest first. If something is worth under 1% of annual income, leave it out entirely.",
      "- annualImpactCents is your estimate of the yearly difference in minor units, positive for money gained or saved.",
      "- Be specific to these numbers. A sentence that would be true for anyone is worthless here.",
      "- If unexplained spending is significant, say so first: an unknown is not a saving opportunity, it is a data problem.",
      "- confidence is low when the data is thin, and say what would raise it.",
      "",
      'Answer as {"verdict":"what this month actually shows, plainly","moves":[{"title":"...","detail":"...","annualImpactCents":int,"confidence":"high|medium|low"}],"watch":["short warnings"]}',
    ].join("\n"),
    analysis,
    { lane: "kompass-hard", maxTokens: 4096, system: SYSTEM, signal },
  )
}

const scenario = z.object({
  answer: z.string().max(2000),
  numbers: z
    .array(z.object({ label: z.string().max(80), valueCents: z.number().int() }))
    .max(8),
  caveats: z.array(z.string().max(240)).max(4),
})

export type ScenarioAnswer = z.infer<typeof scenario>

/**
 * "What if my rent rises €200?" answered against the real numbers rather than
 * against a general truth about rent. The stated arithmetic is returned
 * separately so the user can check the sum rather than trust the paragraph.
 */
export async function answerScenario(
  question: string,
  snapshot: Snapshot,
  signal?: AbortSignal,
): Promise<ScenarioAnswer> {
  return askJson(
    [
      `Answer this question against the person's real data: "${question}"`,
      "",
      renderSnapshot(snapshot),
      "",
      "Rules:",
      "- Do the arithmetic explicitly and put each figure you used in `numbers`, so it can be checked.",
      "- Answer the question that was asked. If it cannot be answered from this data, say exactly what is missing.",
      "- No product recommendations.",
      "",
      'Answer as {"answer":"...","numbers":[{"label":"...","valueCents":int}],"caveats":["..."]}',
    ].join("\n"),
    scenario,
    { lane: "kompass-hard", maxTokens: 3072, system: SYSTEM, signal },
  )
}

const audit = z.object({
  findings: z.array(
    z.object({
      kind: z.enum(["duplicate", "dead_subscription", "tax", "price_rise", "other"]),
      title: z.string().max(120),
      detail: z.string().max(900),
      annualImpactCents: z.number().int(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  summary: z.string().max(700),
})

export type Audit = z.infer<typeof audit>

/**
 * The annual sweep for leaks: two insurance policies covering the same thing,
 * a gym nobody has been to, a deductible expense sitting uncounted.
 *
 * Tax findings are the ones most likely to be confidently wrong, so the prompt
 * names the country's system and demands the finding be phrased as something
 * to check rather than something that is true.
 */
export async function annualAudit(snapshot: Snapshot, signal?: AbortSignal): Promise<Audit> {
  return askJson(
    [
      "Audit this person's money for leaks over the last year.",
      "",
      renderSnapshot(snapshot),
      "",
      `Tax context: ${taxContextFor(snapshot.country)}`,
      "",
      "Look for, in this order of value:",
      "- duplicate mandates: two charges that plausibly cover the same thing",
      "- dead subscriptions: recurring charges that stopped being used, or whose last charge suggests a forgotten trial",
      "- price rises: a recurring charge whose amount crept up",
      "- likely tax deductions in the data, phrased as 'worth checking whether X is deductible', never as a statement of law",
      "",
      "Rules:",
      "- annualImpactCents is the yearly money at stake, in minor units.",
      "- Do not pad the list. Three real findings beat ten plausible ones.",
      "- Anything you cannot support from the data given does not go in.",
      "",
      'Answer as {"findings":[{"kind":"duplicate|dead_subscription|tax|price_rise|other","title":"...","detail":"...","annualImpactCents":int,"confidence":"high|medium|low"}],"summary":"..."}',
    ].join("\n"),
    audit,
    { lane: "kompass-hard", maxTokens: 4096, system: SYSTEM, signal },
  )
}

const allocation = z.object({
  allocations: z.array(
    z.object({
      label: z.string().max(80),
      amountCents: z.number().int().nonnegative(),
      reason: z.string().max(400),
    }),
  ),
  summary: z.string().max(900),
})

export type Allocation = z.infer<typeof allocation>

/**
 * Irregular money, decided before it arrives.
 *
 * A bonus that lands with no plan becomes consumption within the month, which
 * is the windfall receiver's actual problem — not a lack of options.
 */
export async function allocateWindfall(
  amountCents: number,
  note: string,
  snapshot: Snapshot,
  signal?: AbortSignal,
): Promise<Allocation> {
  return askJson(
    [
      `Propose how to allocate an incoming one-off amount of ${(amountCents / 100).toFixed(2)} ${snapshot.currency}. Context from the user: "${note || "none given"}".`,
      "",
      renderSnapshot(snapshot),
      "",
      "Rules:",
      "- The allocations must sum to exactly the amount given.",
      "- Reason from this person's actual position: thin liquidity, an overrunning category, a fixed cost that is too high a share of income.",
      "- Name no products. 'Three months of expenses kept liquid' is an allocation; a fund is not.",
      "- Leaving a deliberate share for spending is a legitimate allocation, and saying so beats a plan nobody follows.",
      "",
      'Answer as {"allocations":[{"label":"...","amountCents":int,"reason":"..."}],"summary":"..."}',
    ].join("\n"),
    allocation,
    { lane: "kompass-hard", maxTokens: 2048, system: SYSTEM, signal },
  )
}
