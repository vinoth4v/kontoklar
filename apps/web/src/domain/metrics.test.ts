import { describe, expect, it } from "vitest"
import {
  balances,
  flows,
  headline,
  type MetricAccount,
  type MetricCategory,
  type MetricTxn,
  projectedOverruns,
  summariseMonth,
  variance,
} from "./metrics.ts"

const ACCOUNTS: MetricAccount[] = [
  { id: "chk", name: "Current", kind: "checking", openingBalanceCents: 100000, archivedAt: null },
  { id: "sav", name: "Savings", kind: "savings", openingBalanceCents: 500000, archivedAt: null },
  { id: "card", name: "Card", kind: "credit_card", openingBalanceCents: 0, archivedAt: null },
]

const CATEGORIES: MetricCategory[] = [
  { id: "salary", name: "Salary", kind: "income", fixedCost: false, groupId: null },
  { id: "rent", name: "Rent", kind: "expense", fixedCost: true, groupId: null },
  { id: "food", name: "Food", kind: "expense", fixedCost: false, groupId: null },
  { id: "pot", name: "Savings pot", kind: "savings", fixedCost: false, groupId: null },
]

function txn(
  id: string,
  amountCents: number,
  categoryId: string | null,
  spentOn = "2025-01-10",
  role: MetricTxn["role"] = "spending",
  accountId = "chk",
): MetricTxn {
  return { id, accountId, spentOn, amountCents, categoryId, role }
}

describe("summariseMonth", () => {
  const txns = [
    txn("1", 300000, "salary"),
    txn("2", -110000, "rent"),
    txn("3", -40000, "food"),
    txn("4", -50000, "pot"),
    txn("5", -7500, null),
    txn("6", -20000, null, "2025-01-12", "transfer"),
    txn("7", -35000, null, "2025-01-20", "settlement"),
    txn("8", -99999, "food", "2024-12-30"),
  ]

  const summary = summariseMonth(txns, CATEGORIES, "2025-01")

  it("counts only spending, and only this month", () => {
    expect(summary.incomeCents).toBe(300000)
    // Transfers and settlements move money without spending it, and December
    // is not January.
    expect(summary.expenseCents).toBe(110000 + 40000 + 7500)
  })

  it("keeps money set aside out of spending", () => {
    expect(summary.savingsCents).toBe(50000)
  })

  it("counts an uncategorised outflow as expense and reports it separately", () => {
    expect(summary.unexplainedCents).toBe(7500)
  })

  it("tracks the fixed share", () => {
    expect(summary.fixedCents).toBe(110000)
  })

  it("leaves over what is actually left", () => {
    expect(summary.netCents).toBe(300000 - 157500 - 50000)
  })
})

describe("balances", () => {
  it("counts every line, transfers included", () => {
    const result = balances(ACCOUNTS, [
      txn("1", -20000, null, "2025-01-12", "transfer", "chk"),
      txn("2", 20000, null, "2025-01-12", "transfer", "sav"),
      txn("3", -4520, "food", "2025-01-13", "spending", "chk"),
    ])

    expect(result.get("chk")).toBe(100000 - 20000 - 4520)
    expect(result.get("sav")).toBe(520000)
  })
})

describe("headline", () => {
  it("divides by income, and reports nothing rather than infinity without it", () => {
    const withIncome = headline(
      [summariseMonth([txn("1", 200000, "salary"), txn("2", -100000, "rent")], CATEGORIES, "2025-01")],
      ACCOUNTS,
      balances(ACCOUNTS, []),
    )

    expect(withIncome.savingsRate).toBeCloseTo(0.5)
    expect(withIncome.fixedCostShare).toBeCloseTo(0.5)
    // Liquid is checking plus savings; the card is not liquidity.
    expect(withIncome.liquidCents).toBe(600000)
    expect(withIncome.monthsOfLiquidity).toBeCloseTo(6)

    const withoutIncome = headline(
      [summariseMonth([], CATEGORIES, "2025-01")],
      ACCOUNTS,
      balances(ACCOUNTS, []),
    )
    expect(withoutIncome.savingsRate).toBeNull()
    expect(withoutIncome.monthsOfLiquidity).toBeNull()
  })
})

describe("variance", () => {
  const summary = summariseMonth(
    [txn("1", 280000, "salary"), txn("2", -120000, "rent"), txn("3", -30000, "food")],
    CATEGORIES,
    "2025-01",
  )
  const lines = variance(
    summary,
    CATEGORIES,
    new Map([
      ["salary", 300000],
      ["rent", 110000],
      ["food", 40000],
    ]),
  )

  it("reads over-budget as negative for expenses and under-target as negative for income", () => {
    expect(lines.find((line) => line.categoryId === "rent")?.differenceCents).toBe(-10000)
    expect(lines.find((line) => line.categoryId === "food")?.differenceCents).toBe(10000)
    expect(lines.find((line) => line.categoryId === "salary")?.differenceCents).toBe(-20000)
  })

  it("drops lines with neither a plan nor a movement", () => {
    expect(lines.some((line) => line.categoryId === "pot")).toBe(false)
  })

  it("sorts the worst first", () => {
    expect(lines[0]?.categoryId).toBe("salary")
  })
})

describe("projectedOverruns", () => {
  const summary = summariseMonth([txn("1", -30000, "food", "2025-01-05")], CATEGORIES, "2025-01")
  const planned = new Map([["food", 40000]])

  it("extrapolates the month's pace", () => {
    // 300 by the tenth is 930 by the end, against a plan of 400.
    const overruns = projectedOverruns(summary, CATEGORIES, planned, "2025-01-10")
    expect(overruns).toHaveLength(1)
    expect(overruns[0]?.projectedCents).toBe(93000)
  })

  it("says nothing in the first days, when one big shop proves nothing", () => {
    expect(projectedOverruns(summary, CATEGORIES, planned, "2025-01-03")).toHaveLength(0)
  })

  it("says nothing about a month that is not the one being viewed", () => {
    expect(projectedOverruns(summary, CATEGORIES, planned, "2025-02-10")).toHaveLength(0)
  })
})

describe("flows", () => {
  it("aggregates paired transfers into one edge per direction", () => {
    const edges = flows([
      { ...txn("1", -20000, null, "2025-01-12", "transfer", "chk"), transferGroup: "g1" },
      { ...txn("2", 20000, null, "2025-01-12", "transfer", "sav"), transferGroup: "g1" },
      { ...txn("3", -10000, null, "2025-02-12", "transfer", "chk"), transferGroup: "g2" },
      { ...txn("4", 10000, null, "2025-02-12", "transfer", "sav"), transferGroup: "g2" },
      { ...txn("5", -4520, "food", "2025-01-13", "spending", "chk"), transferGroup: null },
    ])

    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ fromId: "chk", toId: "sav", amountCents: 30000, count: 2 })
  })
})
