import type { IsoDate } from "@/domain/money"
import { daysBetween } from "@/domain/money"
import type { AccountKind, TxnRole } from "@/db/schema"

/**
 * The part of the app that earns its name.
 *
 * Two things distort a monthly picture more than any mis-categorisation:
 * money moving between your own accounts (counted as spending twice), and a
 * credit card (counted in the month it was paid off rather than the month it
 * was spent). Both are solved here, on plain data, so both are testable
 * without a database and without a model.
 */

export type ReconcilableAccount = {
  id: string
  kind: AccountKind
  settlementAccountId: string | null
}

export type ReconcilableTxn = {
  id: string
  accountId: string
  bookedOn: IsoDate
  spentOn: IsoDate
  amountCents: number
  description: string
  role: TxnRole
  transferGroup: string | null
  confirmedByUser: boolean
}

export type TransferPair = {
  /** The outgoing side. */
  fromId: string
  /** The incoming side. */
  toId: string
  /** `settlement` when one side is a card being paid off by its own settlement
   * account: the money is not a transfer between two savings pots, it is the
   * closing of charges already counted as spending. */
  role: Extract<TxnRole, "transfer" | "settlement">
  amountCents: number
  daysApart: number
}

const DEFAULT_WINDOW_DAYS = 5

/**
 * Pair each outgoing line with the incoming line that is its other half.
 *
 * Matched on exact amount across two different accounts within a few days,
 * nearest date first, each line used at most once. Exactness is deliberate:
 * an approximate match would quietly swallow a real expense that happened to
 * resemble a transfer, and the failure mode of missing a pair (the user marks
 * it by hand) is far kinder than the failure mode of inventing one.
 *
 * A line the user has already confirmed is left alone — a correction is never
 * undone by a later automatic pass.
 */
export function detectTransfers(
  txns: readonly ReconcilableTxn[],
  accounts: readonly ReconcilableAccount[],
  windowDays = DEFAULT_WINDOW_DAYS,
): TransferPair[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const available = txns.filter((t) => !t.transferGroup && !t.confirmedByUser)

  const outgoing = available
    .filter((t) => t.amountCents < 0)
    .sort((a, b) => a.bookedOn.localeCompare(b.bookedOn))
  const incoming = available.filter((t) => t.amountCents > 0)

  const used = new Set<string>()
  const pairs: TransferPair[] = []

  for (const debit of outgoing) {
    if (used.has(debit.id)) continue

    const candidates = incoming
      .filter(
        (credit) =>
          !used.has(credit.id) &&
          credit.accountId !== debit.accountId &&
          credit.amountCents === -debit.amountCents &&
          daysBetween(credit.bookedOn, debit.bookedOn) <= windowDays,
      )
      .sort(
        (a, b) =>
          daysBetween(a.bookedOn, debit.bookedOn) - daysBetween(b.bookedOn, debit.bookedOn) ||
          a.id.localeCompare(b.id),
      )

    const credit = candidates[0]
    if (!credit) continue

    used.add(debit.id)
    used.add(credit.id)

    pairs.push({
      fromId: debit.id,
      toId: credit.id,
      role: isSettlement(byId.get(debit.accountId), byId.get(credit.accountId)) ? "settlement" : "transfer",
      amountCents: -debit.amountCents,
      daysApart: daysBetween(credit.bookedOn, debit.bookedOn),
    })
  }

  return pairs
}

/** A debit on the settlement account landing as a credit on its card. */
function isSettlement(
  from: ReconcilableAccount | undefined,
  to: ReconcilableAccount | undefined,
): boolean {
  if (!from || !to) return false
  if (to.kind === "credit_card" && to.settlementAccountId === from.id) return true
  if (from.kind === "credit_card" && from.settlementAccountId === to.id) return true
  return false
}

export type SettlementReconciliation = {
  paymentId: string
  cardAccountId: string
  matchedChargeIds: string[]
  /** Positive. How much of the payment is explained by imported charges. */
  matchedCents: number
  /** Positive. What the payment covered that no charge accounts for — this
   * becomes an "unexplained spending" line, never a rounding-away. */
  remainderCents: number
}

/**
 * Explain a card payment in terms of the charges it settles.
 *
 * The case that matters is the common one: the checking statement is imported
 * and the card statement is not. The payment is then the only evidence of a
 * month of spending, and three answers are possible — none of which may be
 * "drop it".
 *
 *   - charges cover the payment  → the payment is a settlement, excluded from
 *     spending, and the charges already carry the categories
 *   - charges cover part of it   → the difference is unexplained spending
 *   - no charges at all          → the whole payment is unexplained spending
 *
 * Payments are processed oldest first and consume charges oldest first, so a
 * charge is never claimed by two settlements.
 */
export function reconcileSettlements(
  payments: readonly ReconcilableTxn[],
  charges: readonly ReconcilableTxn[],
  cardAccountId: string,
): SettlementReconciliation[] {
  const queue = charges
    .filter((c) => c.amountCents < 0 && c.role === "spending")
    .sort((a, b) => a.spentOn.localeCompare(b.spentOn) || a.id.localeCompare(b.id))

  const consumed = new Set<string>()
  const out: SettlementReconciliation[] = []

  for (const payment of [...payments].sort(
    (a, b) => a.bookedOn.localeCompare(b.bookedOn) || a.id.localeCompare(b.id),
  )) {
    let outstanding = Math.abs(payment.amountCents)
    const matched: string[] = []

    for (const charge of queue) {
      if (outstanding <= 0) break
      if (consumed.has(charge.id)) continue
      // A charge made after the payment cleared cannot be part of it.
      if (charge.spentOn > payment.bookedOn) continue

      const value = Math.abs(charge.amountCents)
      if (value > outstanding) continue

      consumed.add(charge.id)
      matched.push(charge.id)
      outstanding -= value
    }

    out.push({
      paymentId: payment.id,
      cardAccountId,
      matchedChargeIds: matched,
      matchedCents: Math.abs(payment.amountCents) - outstanding,
      remainderCents: outstanding,
    })
  }

  return out
}

/**
 * Where a card charge belongs in time.
 *
 * The whole point of the card story: the month of purchase, not the month the
 * bank got around to settling. Import gives us the booking date; when a
 * statement carries a separate purchase date it is already in `spentOn`, and
 * this is what keeps the two straight for everything else.
 */
export function attributionDate(txn: Pick<ReconcilableTxn, "bookedOn" | "spentOn">): IsoDate {
  return txn.spentOn
}

/** Lines that count toward spending: not transfers, not settlements. */
export function isSpending(txn: Pick<ReconcilableTxn, "role">): boolean {
  return txn.role === "spending"
}
