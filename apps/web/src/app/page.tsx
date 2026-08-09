import Link from "next/link"
import { redirect } from "next/navigation"
import { quickAddAction } from "@/app/actions"
import { Bar, Empty, FlowDiagram, Money, Notice, Sparkline, Tile } from "@/components/ui"
import { isConfigured } from "@/data/store"
import { loadMonthView } from "@/data/view"
import { formatDate, formatMonth } from "@/domain/money"

// Reads the session cookie and the database, so there is nothing to prerender.
export const dynamic = "force-dynamic"

/**
 * The app.
 *
 * Not a landing page with a link to the app — the production URL opens on this
 * person's actual money. Someone who has not set anything up yet is sent to
 * onboarding instead, which is the only redirect this page does.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; added?: string }>
}) {
  if (!(await isConfigured())) redirect("/onboarding")

  const { month: requested, added } = await searchParams
  const view = await loadMonthView(requested)
  const { currency, locale } = view.settings

  const percent = (value: number | null) =>
    value === null ? "—" : `${(value * 100).toFixed(0)}%`

  const openCategories = view.categories.filter((category) => !category.archivedAt)
  const recent = view.txns.filter((row) => row.role === "spending").slice(0, 8)

  return (
    <main className="app stack">
      <div className="cluster" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>
          {view.settings.householdName} · {formatMonth(view.month, locale)}
        </h1>
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
          <button type="submit">Show</button>
        </form>
      </div>

      {added === "invalid" ? (
        <p role="alert">That amount could not be read, so nothing was added.</p>
      ) : null}

      <section className="tiles">
        <Tile
          label="Savings rate"
          value={percent(view.headline.savingsRate)}
          note="Share of income not consumed, last three months"
        />
        <Tile
          label="Fixed-cost share"
          value={percent(view.headline.fixedCostShare)}
          note="Committed before any choice is made"
        />
        <Tile
          label="Months of liquidity"
          value={
            view.headline.monthsOfLiquidity === null
              ? "—"
              : view.headline.monthsOfLiquidity.toFixed(1)
          }
          note={<Money cents={view.headline.liquidCents} currency={currency} locale={locale} short />}
        />
        <Tile
          label="Net worth"
          value={<Money cents={view.headline.netWorthCents} currency={currency} locale={locale} short />}
          note="Every account, including cards and loans"
        />
      </section>

      {view.overruns.length > 0 || view.summary.unexplainedCents > 0 || view.uncategorisedCount > 0 ? (
        <section className="stack-tight">
          {view.overruns.map((overrun) => (
            <Notice key={overrun.categoryId}>
              <strong>{overrun.name}</strong> is on course for{" "}
              <Money cents={overrun.projectedCents} currency={currency} locale={locale} short /> against a
              plan of <Money cents={overrun.plannedCents} currency={currency} locale={locale} short />.
              There is still time this month.
            </Notice>
          ))}
          {view.summary.unexplainedCents > 0 ? (
            <Notice>
              <Money cents={view.summary.unexplainedCents} currency={currency} locale={locale} /> of
              spending this month has no category.{" "}
              <Link href="/transactions?filter=unexplained">Explain it</Link> — nothing is dropped,
              but nothing is understood either.
            </Notice>
          ) : null}
          {view.uncategorisedCount > 0 ? (
            <Notice>
              {view.uncategorisedCount} transaction{view.uncategorisedCount === 1 ? "" : "s"} across all
              months are uncategorised. <Link href="/transactions?filter=unexplained">Sort them out</Link>
              , and every correction teaches a rule.
            </Notice>
          ) : null}
        </section>
      ) : null}

      <section className="split">
        <div className="card">
          <h2>Plan versus actual</h2>
          {view.variance.length === 0 ? (
            <Empty>
              Nothing planned and nothing spent this month. <Link href="/budget">Set a budget</Link> or{" "}
              <Link href="/import">import a statement</Link>.
            </Empty>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Planned</th>
                    <th className="num">Actual</th>
                    <th className="num">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {view.variance.map((line) => (
                    <tr key={line.categoryId}>
                      <td>
                        {line.name}
                        <Bar ratio={line.ratio} />
                      </td>
                      <td className="num">
                        <Money cents={line.plannedCents} currency={currency} locale={locale} short />
                      </td>
                      <td className="num">
                        <Money cents={line.actualCents} currency={currency} locale={locale} short />
                      </td>
                      <td className="num">
                        <Money
                          cents={line.differenceCents}
                          currency={currency}
                          locale={locale}
                          short
                          signed
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <h2>This month</h2>
            <table>
              <tbody>
                <tr>
                  <td>Income</td>
                  <td className="num">
                    <Money cents={view.summary.incomeCents} currency={currency} locale={locale} />
                  </td>
                </tr>
                <tr>
                  <td>Spending</td>
                  <td className="num">
                    <Money cents={view.summary.expenseCents} currency={currency} locale={locale} />
                  </td>
                </tr>
                <tr>
                  <td>Set aside</td>
                  <td className="num">
                    <Money cents={view.summary.savingsCents} currency={currency} locale={locale} />
                  </td>
                </tr>
                <tr>
                  <td>Unexplained</td>
                  <td className="num">
                    <Money cents={view.summary.unexplainedCents} currency={currency} locale={locale} />
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Left over</strong>
                  </td>
                  <td className="num">
                    <Money
                      cents={view.summary.netCents}
                      currency={currency}
                      locale={locale}
                      signed
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Direction</h2>
            <p className="small muted">Balance across every account, twelve months</p>
            <Sparkline points={view.balanceTrend} />
            <p className="small muted">Monthly spending</p>
            <Sparkline points={view.spendTrend} />
          </div>
        </div>
      </section>

      <section className="split">
        <div className="card">
          <h2>Add something quickly</h2>
          <form action={quickAddAction} className="stack-tight">
            <div className="fields">
              <div className="field">
                <label htmlFor="amount">Amount</label>
                <input id="amount" name="amount" inputMode="decimal" placeholder="12,50" required />
              </div>
              <div className="field">
                <label htmlFor="description">What</label>
                <input id="description" name="description" placeholder="Bakery" />
              </div>
              <div className="field">
                <label htmlFor="spentOn">When</label>
                <input id="spentOn" name="spentOn" type="date" defaultValue={view.today} required />
              </div>
              <div className="field">
                <label htmlFor="accountId">Account</label>
                <select id="accountId" name="accountId" required>
                  {view.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="categoryId">Category</label>
                <select id="categoryId" name="categoryId" defaultValue="">
                  <option value="">Let it work it out</option>
                  {openCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="direction">Direction</label>
                <select id="direction" name="direction" defaultValue="out">
                  <option value="out">Money out</option>
                  <option value="in">Money in</option>
                </select>
              </div>
            </div>
            <div className="actions">
              <button type="submit">Add</button>
              <span className="hint">
                Works with no bank import at all — everything here is usable by hand.
              </span>
            </div>
          </form>
        </div>

        <div className="card">
          <h2>Latest</h2>
          {recent.length === 0 ? (
            <Empty>
              No transactions yet. <Link href="/import">Import a statement</Link>.
            </Empty>
          ) : (
            <div className="scroll">
              <table>
                <tbody>
                  {recent.map((row) => (
                    <tr key={row.id}>
                      <td className="muted small">{formatDate(row.spentOn, locale)}</td>
                      <td>{row.description.slice(0, 60)}</td>
                      <td className="num">
                        <Money cents={row.amountCents} currency={currency} locale={locale} signed />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="actions">
            <Link href="/transactions">All transactions</Link>
          </p>
        </div>
      </section>

      {view.flows.length > 0 ? (
        <section className="card">
          <h2>How money moves</h2>
          <p className="small muted">
            Drawn from the transfers reconciliation found between your own accounts — not a diagram
            you had to draw.
          </p>
          <FlowDiagram
            edges={view.flows}
            names={new Map(view.accounts.map((account) => [account.id, account.name]))}
            currency={currency}
            locale={locale}
          />
        </section>
      ) : null}
    </main>
  )
}
