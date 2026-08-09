import type { AccountKind, CategoryKind } from "@/db/schema"
import { addMonths, type IsoDate, type Month, monthOf } from "@/domain/money"

/**
 * Every number the app shows, derived in one place from plain rows.
 *
 * Nothing here touches the database or the model, which is the point: the
 * arithmetic a personal finance app lives or dies by should be provable by a
 * unit test, not inspected by squinting at a dashboard.
 *
 * The convention throughout: amounts are signed cents, money out is negative,
 * and only `role === "spending"` lines count toward a budget. Transfers and
 * card settlements move balances but are not spending — that distinction is
 * the difference between a plausible dashboard and a true one.
 */

export type MetricTxn = {
  id: string
  accountId: string
  spentOn: IsoDate
  amountCents: number
  categoryId: string | null
  role: "spending" | "transfer" | "settlement"
}

export type MetricCategory = {
  id: string
  name: string
  kind: CategoryKind
  fixedCost: boolean
  groupId: string | null
}

export type MetricAccount = {
  id: string
  name: string
  kind: AccountKind
  openingBalanceCents: number
  archivedAt: Date | null
}

/** What a month came to. All fields are positive magnitudes except `netCents`. */
export type MonthSummary = {
  month: Month
  incomeCents: number
  expenseCents: number
  savingsCents: number
  fixedCents: number
  unexplainedCents: number
  netCents: number
  byCategory: Map<string, number>
}

const LIQUID: readonly AccountKind[] = ["checking", "savings", "cash"]

export function balances(
  accounts: readonly MetricAccount[],
  txns: readonly MetricTxn[],
): Map<string, number> {
  const out = new Map(accounts.map((a) => [a.id, a.openingBalanceCents]))
  // Balances count everything, transfers included — moving money changes
  // where it is, even though it changes nothing about what was spent.
  for (const txn of txns) {
    out.set(txn.accountId, (out.get(txn.accountId) ?? 0) + txn.amountCents)
  }
  return out
}

export function liquidCents(
  accounts: readonly MetricAccount[],
  balanceByAccount: ReadonlyMap<string, number>,
): number {
  return accounts
    .filter((a) => !a.archivedAt && LIQUID.includes(a.kind))
    .reduce((sum, a) => sum + (balanceByAccount.get(a.id) ?? 0), 0)
}

/**
 * Summarise one month.
 *
 * An uncategorised outflow is *unexplained*, not zero: it still counts as
 * expense, and it is reported separately so it can be chased. Money silently
 * vanishing from a total is the failure this app exists to prevent.
 */
export function summariseMonth(
  txns: readonly MetricTxn[],
  categories: readonly MetricCategory[],
  month: Month,
): MonthSummary {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const summary: MonthSummary = {
    month,
    incomeCents: 0,
    expenseCents: 0,
    savingsCents: 0,
    fixedCents: 0,
    unexplainedCents: 0,
    netCents: 0,
    byCategory: new Map(),
  }

  for (const txn of txns) {
    if (txn.role !== "spending") continue
    if (monthOf(txn.spentOn) !== month) continue

    const category = txn.categoryId ? byId.get(txn.categoryId) : undefined
    const magnitude = Math.abs(txn.amountCents)

    if (txn.categoryId) {
      summary.byCategory.set(txn.categoryId, (summary.byCategory.get(txn.categoryId) ?? 0) + magnitude)
    }

    if (category?.kind === "savings") {
      // Money set aside is neither income nor consumption; it is the result.
      if (txn.amountCents < 0) summary.savingsCents += magnitude
      else summary.savingsCents -= magnitude
      continue
    }

    if (txn.amountCents > 0) {
      summary.incomeCents += magnitude
      continue
    }

    summary.expenseCents += magnitude
    if (category?.fixedCost) summary.fixedCents += magnitude
    if (!category) summary.unexplainedCents += magnitude
  }

  summary.netCents = summary.incomeCents - summary.expenseCents - summary.savingsCents
  return summary
}

export type Headline = {
  /** Share of income not consumed, 0–1. Null when there was no income to divide by. */
  savingsRate: number | null
  /** Share of income committed before any choice is made, 0–1. */
  fixedCostShare: number | null
  /** How long liquid money covers an average month of spending. */
  monthsOfLiquidity: number | null
  liquidCents: number
  netWorthCents: number
}

/**
 * The four numbers that answer "am I fine?" — which is a different question
 * from "what did I spend on", and the one people actually open the app for.
 *
 * Liquidity uses an average of recent *complete* months: a half-finished month
 * would halve the burn rate and report twice the runway, which is the exact
 * moment a metric stops being useful and starts being flattering.
 */
export function headline(
  history: readonly MonthSummary[],
  accounts: readonly MetricAccount[],
  balanceByAccount: ReadonlyMap<string, number>,
): Headline {
  const complete = history.slice(0, 3)
  const income = complete.reduce((sum, m) => sum + m.incomeCents, 0)
  const expense = complete.reduce((sum, m) => sum + m.expenseCents, 0)
  const fixed = complete.reduce((sum, m) => sum + m.fixedCents, 0)

  const liquid = liquidCents(accounts, balanceByAccount)
  const netWorth = accounts
    .filter((a) => !a.archivedAt)
    .reduce((sum, a) => sum + (balanceByAccount.get(a.id) ?? 0), 0)

  const averageExpense = complete.length > 0 ? expense / complete.length : 0

  return {
    savingsRate: income > 0 ? (income - expense) / income : null,
    fixedCostShare: income > 0 ? fixed / income : null,
    monthsOfLiquidity: averageExpense > 0 ? liquid / averageExpense : null,
    liquidCents: liquid,
    netWorthCents: netWorth,
  }
}

export type VarianceLine = {
  categoryId: string
  name: string
  kind: CategoryKind
  plannedCents: number
  actualCents: number
  /** Negative means over budget for an expense, under target for income. */
  differenceCents: number
  /** Actual as a share of plan, or null when nothing was planned. */
  ratio: number | null
}

/**
 * Plan against reality, per category.
 *
 * Categories with neither a plan nor a movement are dropped — an empty grid of
 * zeroes hides the six lines that matter. A category with spending and no plan
 * stays, loudly: that is the most common way a budget turns out to be fiction.
 */
export function variance(
  summary: MonthSummary,
  categories: readonly MetricCategory[],
  planned: ReadonlyMap<string, number>,
): VarianceLine[] {
  const lines: VarianceLine[] = []

  for (const category of categories) {
    const plannedCents = planned.get(category.id) ?? 0
    const actualCents = summary.byCategory.get(category.id) ?? 0
    if (plannedCents === 0 && actualCents === 0) continue

    lines.push({
      categoryId: category.id,
      name: category.name,
      kind: category.kind,
      plannedCents,
      actualCents,
      differenceCents:
        category.kind === "income" ? actualCents - plannedCents : plannedCents - actualCents,
      ratio: plannedCents > 0 ? actualCents / plannedCents : null,
    })
  }

  return lines.sort((a, b) => a.differenceCents - b.differenceCents)
}

export type Overrun = {
  categoryId: string
  name: string
  plannedCents: number
  actualCents: number
  projectedCents: number
}

/**
 * Categories on course to blow their budget, judged part-way through a month.
 *
 * Spend so far is extrapolated over the whole month at the same pace. Crude,
 * and deliberately so — the alert is useful at day ten, when a correction is
 * still possible, and a model of weekly spending rhythm would not change what
 * the user does about it.
 */
export function projectedOverruns(
  summary: MonthSummary,
  categories: readonly MetricCategory[],
  planned: ReadonlyMap<string, number>,
  today: IsoDate,
  threshold = 1.05,
): Overrun[] {
  if (monthOf(today) !== summary.month) return []

  const day = Number(today.slice(8, 10))
  const daysInMonth = new Date(
    Date.UTC(Number(summary.month.slice(0, 4)), Number(summary.month.slice(5, 7)), 0),
  ).getUTCDate()
  // Too early to extrapolate: one big grocery run should not raise an alarm.
  if (day < 5) return []

  const out: Overrun[] = []

  for (const category of categories) {
    if (category.kind !== "expense") continue
    const plannedCents = planned.get(category.id) ?? 0
    if (plannedCents <= 0) continue

    const actualCents = summary.byCategory.get(category.id) ?? 0
    const projectedCents = Math.round((actualCents / day) * daysInMonth)
    if (projectedCents > plannedCents * threshold) {
      out.push({
        categoryId: category.id,
        name: category.name,
        plannedCents,
        actualCents,
        projectedCents,
      })
    }
  }

  return out.sort((a, b) => b.projectedCents - b.plannedCents - (a.projectedCents - a.plannedCents))
}

/** A series for a sparkline: oldest first, which is how a line is read. */
export function series(
  history: readonly MonthSummary[],
  pick: (summary: MonthSummary) => number,
): { month: Month; value: number }[] {
  return [...history].reverse().map((summary) => ({ month: summary.month, value: pick(summary) }))
}

/** Running balance at the end of each of the given months, oldest first. */
export function balanceHistory(
  accounts: readonly MetricAccount[],
  txns: readonly MetricTxn[],
  months: readonly Month[],
): { month: Month; value: number }[] {
  const opening = accounts.reduce((sum, a) => sum + a.openingBalanceCents, 0)
  const ordered = [...months].sort()

  return ordered.map((month) => {
    const cutoff = addMonths(month, 1)
    const total = txns
      .filter((txn) => monthOf(txn.spentOn) < cutoff)
      .reduce((sum, txn) => sum + txn.amountCents, opening)
    return { month, value: total }
  })
}

/** Money that moved between accounts, aggregated for the flow diagram. */
export type FlowEdge = { fromId: string; toId: string; amountCents: number; count: number }

export function flows(
  txns: readonly (MetricTxn & { transferGroup: string | null })[],
): FlowEdge[] {
  const groups = new Map<string, (MetricTxn & { transferGroup: string | null })[]>()
  for (const txn of txns) {
    if (!txn.transferGroup) continue
    const bucket = groups.get(txn.transferGroup)
    if (bucket) bucket.push(txn)
    else groups.set(txn.transferGroup, [txn])
  }

  const edges = new Map<string, FlowEdge>()
  for (const pair of groups.values()) {
    const from = pair.find((t) => t.amountCents < 0)
    const to = pair.find((t) => t.amountCents > 0)
    if (!from || !to) continue
    const key = `${from.accountId}->${to.accountId}`
    const existing = edges.get(key)
    if (existing) {
      existing.amountCents += Math.abs(from.amountCents)
      existing.count += 1
    } else {
      edges.set(key, {
        fromId: from.accountId,
        toId: to.accountId,
        amountCents: Math.abs(from.amountCents),
        count: 1,
      })
    }
  }

  return [...edges.values()].sort((a, b) => b.amountCents - a.amountCents)
}
