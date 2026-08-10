import { z } from "zod"
import { askJson } from "@/ai/json"
import type { ParsedLine } from "@/domain/csv"
import { taxContextFor } from "@/domain/locale"

/**
 * The first ten minutes.
 *
 * Two ways in, both of which produce the same thing — a set of groups,
 * categories and monthly planned amounts the user can immediately edit:
 *
 *   - from a statement, which is the honest one: the plan starts as what is
 *     already happening, which is the only budget anyone keeps
 *   - from answers to a handful of questions, for someone with no file to hand
 *
 * Neither invents a taxonomy the user then has to live inside. The model is
 * told to name categories the way this person's money actually behaves, and
 * every line is editable before anything is saved.
 */

const draft = z.object({
  groups: z.array(
    z.object({
      name: z.string().min(1).max(60),
      categories: z.array(
        z.object({
          name: z.string().min(1).max(60),
          kind: z.enum(["income", "expense", "savings"]),
          fixedCost: z.boolean(),
          plannedCents: z.number().int(),
          note: z.string().max(160).optional(),
        }),
      ),
    }),
  ),
  summary: z.string().max(1200),
})

export type BudgetDraft = z.infer<typeof draft>

export type OnboardingAnswers = {
  householdName: string
  country: string
  currency: string
  earners: string
  netIncome: string
  housing: string
  housingCost: string
  commitments: string
  goals: string
}

export async function draftFromAnswers(
  answers: OnboardingAnswers,
  signal?: AbortSignal,
): Promise<BudgetDraft> {
  return askJson(
    [
      "Draft a monthly budget for this person from what they told you. Amounts are in minor units (cents) of their currency.",
      "",
      `Household: ${answers.householdName}`,
      `Country: ${answers.country} (${answers.currency})`,
      `Who earns: ${answers.earners}`,
      `Monthly net income: ${answers.netIncome}`,
      `Housing: ${answers.housing}, costing ${answers.housingCost}`,
      `Regular commitments: ${answers.commitments}`,
      `Goals: ${answers.goals}`,
      "",
      "Rules:",
      "- Name categories after how this person's money actually behaves, not a generic template. A shared flat is not a family.",
      "- Include a savings category if their income allows one, and be realistic rather than aspirational.",
      "- fixedCost is true only for committed obligations: rent, insurance, loans, subscriptions.",
      "- Income categories carry the expected income as plannedCents, positive.",
      "- Expense and savings categories carry a positive plannedCents too — the sign is implied by kind.",
      "- Six to fourteen categories. A budget nobody can hold in their head is a budget nobody keeps.",
      "",
      'Answer as {"groups":[{"name":"...","categories":[{"name":"...","kind":"income|expense|savings","fixedCost":bool,"plannedCents":int,"note":"..."}]}],"summary":"two or three sentences on what you assumed"}',
    ].join("\n"),
    draft,
    { lane: "kompass-agentic", maxTokens: 4096, signal },
  )
}

export async function draftFromStatement(
  lines: readonly ParsedLine[],
  currency: string,
  country: string,
  signal?: AbortSignal,
): Promise<BudgetDraft> {
  const sample = lines
    .slice(0, 400)
    .map((line) => `${line.spentOn} ${(line.amountCents / 100).toFixed(2)} ${line.counterparty ?? ""} ${line.description}`.slice(0, 160))
    .join("\n")

  const months = new Set(lines.map((line) => line.spentOn.slice(0, 7))).size || 1

  return askJson(
    [
      `Draft a monthly budget from this person's real transactions. Currency ${currency}; they live in ${country}, where the relevant tax system is ${taxContextFor(country)}.`,
      `The data spans about ${months} month${months === 1 ? "" : "s"} — divide totals accordingly to get a monthly plan.`,
      "",
      sample,
      "",
      "Rules:",
      "- Group and name categories after what is actually in this data. Do not import a template.",
      "- Ignore transfers between the person's own accounts if you can spot them; they are not spending.",
      "- plannedCents is a realistic monthly figure in minor units, positive for every kind.",
      "- fixedCost is true only for committed recurring obligations.",
      "- Six to sixteen categories.",
      "",
      'Answer as {"groups":[{"name":"...","categories":[{"name":"...","kind":"income|expense|savings","fixedCost":bool,"plannedCents":int,"note":"what in the data this is based on"}]}],"summary":"what you saw, in two or three sentences"}',
    ].join("\n"),
    draft,
    { lane: "kompass-agentic", maxTokens: 6144, signal },
  )
}
