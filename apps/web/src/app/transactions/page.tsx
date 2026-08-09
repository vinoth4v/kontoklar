import {
  deleteTxnAction,
  recategoriseAction,
  reconcileAction,
  updateTxnAction,
} from "@/app/transactions/actions"
import { Empty, Money } from "@/components/ui"
import { loadMonthView } from "@/data/view"
import { TXN_ROLES } from "@/db/schema"
import { formatDate, formatMonth, monthOf } from "@/domain/money"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 200

/**
 * The ledger, and the place corrections are made.
 *
 * Everything the pipeline could not explain is reachable from here in one
 * click, because an unexplained bucket nobody opens is the same as data
 * silently thrown away.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; account?: string; filter?: string }>
}) {
  const { month: requested, account: accountFilter, filter } = await searchParams
  const view = await loadMonthView(requested)
  const { currency, locale } = view.settings

  const categories = view.categories.filter((category) => !category.archivedAt)
  const cards = view.accounts.filter((account) => account.kind === "credit_card")
  const accountName = new Map(view.accounts.map((account) => [account.id, account.name]))

  const unexplainedOnly = filter === "unexplained"

  const rows = view.txns
    .filter((row) => (unexplainedOnly ? row.role === "spending" && !row.categoryId : true))
    .filter((row) => (accountFilter ? row.accountId === accountFilter : true))
    // The unexplained view is deliberately not month-scoped: the point is to
    // reach every loose end, not this month's loose ends.
    .filter((row) => (unexplainedOnly ? true : monthOf(row.spentOn) === view.month))
    .slice(0, PAGE_SIZE)

  return (
    <main className="app stack">
      <div>
        <h1>Transactions</h1>
        <p className="muted">
          {unexplainedOnly
            ? "Everything with no category, across every month. Each correction becomes a rule, so the same payee is never asked about twice."
            : `${formatMonth(view.month, locale)} — change a category and it is remembered.`}
        </p>
      </div>

      <form className="cluster">
        <div className="field">
          <label htmlFor="month">Month</label>
          <select id="month" name="month" defaultValue={view.month}>
            {view.months.map((month) => (
              <option key={month} value={month}>
                {formatMonth(month, locale)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="account">Account</label>
          <select id="account" name="account" defaultValue={accountFilter ?? ""}>
            <option value="">All accounts</option>
            {view.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter">Show</label>
          <select id="filter" name="filter" defaultValue={filter ?? ""}>
            <option value="">This month</option>
            <option value="unexplained">Unexplained only</option>
          </select>
        </div>
        <button type="submit">Apply</button>
      </form>

      <div className="cluster">
        <form action={recategoriseAction}>
          <button className="quiet" type="submit">
            Categorise what is left
          </button>
        </form>
        <form action={reconcileAction}>
          <button className="quiet" type="submit">
            Re-run reconciliation
          </button>
        </form>
        <span className="hint">
          {view.uncategorisedCount} uncategorised in total. Rules run first and cost nothing; the
          model is only asked about what is left.
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty>
          {unexplainedOnly
            ? "Nothing is unexplained. Everything that moved has a category."
            : "No transactions in this month yet."}
        </Empty>
      ) : (
        <section className="card scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th className="num">Amount</th>
                <th>Category and role</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="muted small">{formatDate(row.spentOn, locale)}</td>
                  <td>
                    {row.description.slice(0, 90)}
                    {row.counterparty ? (
                      <>
                        <br />
                        <span className="muted small">{row.counterparty.slice(0, 60)}</span>
                      </>
                    ) : null}
                    {row.aiReason ? (
                      <>
                        <br />
                        <span className="muted small">
                          {row.aiReason.slice(0, 120)}
                          {row.aiConfidence !== null && !row.confirmedByUser
                            ? ` (${row.aiConfidence}%)`
                            : ""}
                        </span>
                      </>
                    ) : null}
                    {row.source === "reconciliation" ? <span className="pill warn">derived</span> : null}
                  </td>
                  <td className="muted small">{accountName.get(row.accountId) ?? "—"}</td>
                  <td className="num">
                    <Money cents={row.amountCents} currency={currency} locale={locale} signed />
                  </td>
                  <td>
                    <form action={updateTxnAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <select
                        name="categoryId"
                        defaultValue={row.categoryId ?? ""}
                        aria-label="Category"
                      >
                        <option value="">Unexplained</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <select name="role" defaultValue={row.role} aria-label="Role">
                        {TXN_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role === "spending"
                              ? "spending"
                              : role === "transfer"
                                ? "own transfer"
                                : "card payment"}
                          </option>
                        ))}
                      </select>
                      <select
                        name="settlesAccountId"
                        defaultValue={row.settlesAccountId ?? ""}
                        aria-label="Card this pays off"
                      >
                        <option value="">—</option>
                        {cards.map((card) => (
                          <option key={card.id} value={card.id}>
                            {card.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit">Save</button>
                      {row.source === "manual" ? (
                        <button className="quiet" type="submit" formAction={deleteTxnAction}>
                          Delete
                        </button>
                      ) : null}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="hint">
        Marking a payment as a card payment and naming the card it settles is how spending gets
        counted in the month it happened. Anything the payment covers that no imported charge
        explains becomes an unexplained line on that card — never nothing.
      </p>
    </main>
  )
}
