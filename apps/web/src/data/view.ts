import type { Settings } from "@/domain/locale"
import {
  balanceHistory,
  balances,
  flows,
  headline,
  type FlowEdge,
  type Headline,
  type MetricAccount,
  type MetricCategory,
  type MetricTxn,
  type MonthSummary,
  type Overrun,
  projectedOverruns,
  series,
  summariseMonth,
  variance,
  type VarianceLine,
} from "@/domain/metrics"
import { type Month, monthOf, recentMonths } from "@/domain/money"
import { findRecurring, type RecurringCandidate } from "@/domain/rules"
import {
  countUncategorised,
  latestActiveMonth,
  loadAllTxns,
  loadBudget,
  loadWorkspace,
} from "@/data/store"
import type { AccountRow, CategoryGroupRow, CategoryRow, TxnRow } from "@/db/schema"

/**
 * One assembled view of a month, shared by every screen that shows numbers.
 *
 * Built once per request from two queries and pure functions, rather than each
 * page inventing its own aggregation — the dashboard, the money meeting and
 * the advisor all have to agree about what a month came to, and the cheapest
 * way to guarantee that is for there to be only one calculation.
 */

export type MonthView = {
  month: Month
  months: Month[]
  today: string
  settings: Settings
  accounts: AccountRow[]
  groups: CategoryGroupRow[]
  categories: CategoryRow[]
  txns: TxnRow[]
  summary: MonthSummary
  history: MonthSummary[]
  headline: Headline
  variance: VarianceLine[]
  overruns: Overrun[]
  planned: Map<string, number>
  balances: Map<string, number>
  balanceTrend: { month: Month; value: number }[]
  spendTrend: { month: Month; value: number }[]
  flows: FlowEdge[]
  recurring: RecurringCandidate[]
  uncategorisedCount: number
}

export async function loadMonthView(requested?: string): Promise<MonthView> {
  const today = new Date().toISOString().slice(0, 10)
  const workspace = await loadWorkspace()
  const fallback = monthOf(today)
  const month = isMonth(requested) ? requested : await latestActiveMonth(fallback)

  const [txns, planned, uncategorisedCount] = await Promise.all([
    loadAllTxns(),
    loadBudget(month),
    countUncategorised(),
  ])

  const metricTxns: MetricTxn[] = txns.map(toMetricTxn)
  const metricAccounts: MetricAccount[] = workspace.accounts.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    openingBalanceCents: row.openingBalanceCents,
    archivedAt: row.archivedAt,
  }))
  const metricCategories: MetricCategory[] = workspace.categories.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    fixedCost: row.fixedCost,
    groupId: row.groupId,
  }))

  const months = recentMonths(month, 12)
  const history = months.map((each) => summariseMonth(metricTxns, metricCategories, each))
  // `months` always has an entry, but the compiler cannot know that and the
  // fallback costs one pass over data already in memory.
  const summary = history[0] ?? summariseMonth(metricTxns, metricCategories, month)
  const balanceByAccount = balances(metricAccounts, metricTxns)

  return {
    month,
    months,
    today,
    settings: workspace.settings,
    accounts: workspace.accounts,
    groups: workspace.groups,
    categories: workspace.categories,
    txns,
    summary,
    history,
    headline: headline(history, metricAccounts, balanceByAccount),
    variance: variance(summary, metricCategories, planned),
    overruns: projectedOverruns(summary, metricCategories, planned, today),
    planned,
    balances: balanceByAccount,
    balanceTrend: balanceHistory(metricAccounts, metricTxns, months),
    spendTrend: series(history, (each) => each.expenseCents),
    flows: flows(
      txns.map((row) => ({ ...toMetricTxn(row), transferGroup: row.transferGroup })),
    ),
    recurring: findRecurring(
      txns
        .filter((row) => row.role === "spending")
        .map((row) => ({
          description: row.description,
          counterparty: row.counterparty,
          spentOn: row.spentOn,
          amountCents: row.amountCents,
        })),
    ),
    uncategorisedCount,
  }
}

function toMetricTxn(row: TxnRow): MetricTxn {
  return {
    id: row.id,
    accountId: row.accountId,
    spentOn: row.spentOn,
    amountCents: row.amountCents,
    categoryId: row.categoryId,
    role: row.role,
  }
}

export function isMonth(value: string | undefined): value is Month {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value)
}
