import { describe, expect, it } from "vitest"
import {
  detectTransfers,
  type ReconcilableAccount,
  type ReconcilableTxn,
  reconcileSettlements,
} from "./reconcile.ts"

const ACCOUNTS: ReconcilableAccount[] = [
  { id: "chk", kind: "checking", settlementAccountId: null },
  { id: "sav", kind: "savings", settlementAccountId: null },
  { id: "card", kind: "credit_card", settlementAccountId: "chk" },
]

function txn(overrides: Partial<ReconcilableTxn> & { id: string; accountId: string; amountCents: number; bookedOn: string }): ReconcilableTxn {
  return {
    spentOn: overrides.bookedOn,
    description: "",
    role: "spending",
    transferGroup: null,
    confirmedByUser: false,
    ...overrides,
  }
}

describe("detectTransfers", () => {
  it("pairs a debit with the matching credit on another account", () => {
    const pairs = detectTransfers(
      [
        txn({ id: "out", accountId: "chk", amountCents: -20000, bookedOn: "2025-02-01" }),
        txn({ id: "in", accountId: "sav", amountCents: 20000, bookedOn: "2025-02-02" }),
      ],
      ACCOUNTS,
    )

    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ fromId: "out", toId: "in", role: "transfer", amountCents: 20000 })
  })

  it("calls it a settlement when the credit lands on a card this account pays", () => {
    const pairs = detectTransfers(
      [
        txn({ id: "pay", accountId: "chk", amountCents: -50000, bookedOn: "2025-02-01" }),
        txn({ id: "clear", accountId: "card", amountCents: 50000, bookedOn: "2025-02-01" }),
      ],
      ACCOUNTS,
    )

    expect(pairs[0]?.role).toBe("settlement")
  })

  it("leaves ordinary spending alone", () => {
    const pairs = detectTransfers(
      [
        txn({ id: "shop", accountId: "chk", amountCents: -4520, bookedOn: "2025-01-02" }),
        txn({ id: "other", accountId: "sav", amountCents: 4519, bookedOn: "2025-01-02" }),
      ],
      ACCOUNTS,
    )

    // One cent apart is not a transfer. Approximate matching would swallow a
    // real expense, and a missed pair is only a click to fix.
    expect(pairs).toHaveLength(0)
  })

  it("refuses to pair within one account, or outside the window", () => {
    expect(
      detectTransfers(
        [
          txn({ id: "a", accountId: "chk", amountCents: -100, bookedOn: "2025-01-01" }),
          txn({ id: "b", accountId: "chk", amountCents: 100, bookedOn: "2025-01-01" }),
        ],
        ACCOUNTS,
      ),
    ).toHaveLength(0)

    expect(
      detectTransfers(
        [
          txn({ id: "a", accountId: "chk", amountCents: -100, bookedOn: "2025-01-01" }),
          txn({ id: "b", accountId: "sav", amountCents: 100, bookedOn: "2025-01-20" }),
        ],
        ACCOUNTS,
      ),
    ).toHaveLength(0)
  })

  it("never uses one line twice, and prefers the nearest date", () => {
    const pairs = detectTransfers(
      [
        txn({ id: "out", accountId: "chk", amountCents: -100, bookedOn: "2025-01-03" }),
        txn({ id: "far", accountId: "sav", amountCents: 100, bookedOn: "2025-01-01" }),
        txn({ id: "near", accountId: "sav", amountCents: 100, bookedOn: "2025-01-04" }),
      ],
      ACCOUNTS,
    )

    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.toId).toBe("near")
  })

  it("does not touch a line the user has already decided about", () => {
    const pairs = detectTransfers(
      [
        txn({
          id: "out",
          accountId: "chk",
          amountCents: -100,
          bookedOn: "2025-01-03",
          confirmedByUser: true,
        }),
        txn({ id: "in", accountId: "sav", amountCents: 100, bookedOn: "2025-01-03" }),
      ],
      ACCOUNTS,
    )

    expect(pairs).toHaveLength(0)
  })
})

describe("reconcileSettlements", () => {
  const payment = txn({
    id: "pay",
    accountId: "chk",
    amountCents: -50000,
    bookedOn: "2025-02-01",
    role: "settlement",
  })

  it("matches a payment against the charges it settles", () => {
    const [result] = reconcileSettlements(
      [payment],
      [
        txn({ id: "c1", accountId: "card", amountCents: -30000, bookedOn: "2025-01-05" }),
        txn({ id: "c2", accountId: "card", amountCents: -20000, bookedOn: "2025-01-20" }),
      ],
      "card",
    )

    expect(result?.matchedChargeIds).toEqual(["c1", "c2"])
    expect(result?.matchedCents).toBe(50000)
    expect(result?.remainderCents).toBe(0)
  })

  it("leaves the difference as unexplained spending, never as nothing", () => {
    const [result] = reconcileSettlements(
      [payment],
      [txn({ id: "c1", accountId: "card", amountCents: -30000, bookedOn: "2025-01-05" })],
      "card",
    )

    expect(result?.matchedCents).toBe(30000)
    expect(result?.remainderCents).toBe(20000)
  })

  it("treats a payment with no imported charges as entirely unexplained", () => {
    // The common case: the checking statement is imported and the card's is
    // not. That payment is still a month of real spending.
    const [result] = reconcileSettlements([payment], [], "card")

    expect(result?.remainderCents).toBe(50000)
  })

  it("ignores charges made after the payment cleared", () => {
    const [result] = reconcileSettlements(
      [payment],
      [txn({ id: "later", accountId: "card", amountCents: -10000, bookedOn: "2025-02-15" })],
      "card",
    )

    expect(result?.matchedChargeIds).toEqual([])
    expect(result?.remainderCents).toBe(50000)
  })

  it("never lets two payments claim the same charge", () => {
    const results = reconcileSettlements(
      [
        payment,
        txn({
          id: "pay2",
          accountId: "chk",
          amountCents: -30000,
          bookedOn: "2025-03-01",
          role: "settlement",
        }),
      ],
      [
        txn({ id: "c1", accountId: "card", amountCents: -30000, bookedOn: "2025-01-05" }),
        txn({ id: "c2", accountId: "card", amountCents: -20000, bookedOn: "2025-01-20" }),
      ],
      "card",
    )

    expect(results[0]?.matchedChargeIds).toEqual(["c1", "c2"])
    expect(results[1]?.matchedChargeIds).toEqual([])
    expect(results[1]?.remainderCents).toBe(30000)
  })
})
