import type { Snapshot } from "@/ai/advisor"
import type { MonthView } from "@/data/view"

/**
 * What the model is allowed to see.
 *
 * Aggregates and category names — never the raw transaction list. That keeps
 * the prompt small enough to answer well, and it means a payee, an IBAN or a
 * reference line never leaves the database to answer "how was my month".
 * The one exception is the recurring-charge list, where the payee fragment is
 * the finding: an audit cannot report a duplicate mandate without naming it.
 */
export function buildSnapshot(view: MonthView): Snapshot {
  const byId = new Map(view.categories.map((category) => [category.id, category]))

  return {
    currency: view.settings.currency,
    country: view.settings.country,
    month: view.month,
    householdName: view.settings.householdName,
    lines: view.variance.map((line) => ({
      name: line.name,
      kind: line.kind,
      plannedCents: line.plannedCents,
      actualCents: line.actualCents,
      fixedCost: byId.get(line.categoryId)?.fixedCost ?? false,
    })),
    incomeCents: view.summary.incomeCents,
    expenseCents: view.summary.expenseCents,
    savingsCents: view.summary.savingsCents,
    unexplainedCents: view.summary.unexplainedCents,
    liquidCents: view.headline.liquidCents,
    monthsOfLiquidity: view.headline.monthsOfLiquidity,
    history: view.history
      .slice(0, 12)
      .map((month) => ({
        month: month.month,
        incomeCents: month.incomeCents,
        expenseCents: month.expenseCents,
      })),
    recurring: view.recurring.slice(0, 25),
  }
}
