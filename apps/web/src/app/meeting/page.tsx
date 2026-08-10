import Link from "next/link"
import { Empty, Money, Notice } from "@/components/ui"
import { loadNotes } from "@/data/store"
import { loadMonthView } from "@/data/view"
import { formatMonth } from "@/domain/money"

export const dynamic = "force-dynamic"

/**
 * Fifteen minutes, not a fight.
 *
 * One screen, three things: what went well, what did not, and the single
 * decision worth making. Everything else in the app is deliberately absent —
 * a money conversation that opens with a full ledger becomes an argument about
 * a €14 line, and the €300 one never gets discussed.
 */
export default async function MeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month: requested } = await searchParams
  const view = await loadMonthView(requested)
  const { currency, locale } = view.settings

  const wins = view.variance
    .filter((line) => line.kind !== "income" && line.plannedCents > 0 && line.differenceCents > 0)
    .sort((a, b) => b.differenceCents - a.differenceCents)
    .slice(0, 3)

  const overruns = view.variance
    .filter((line) => line.kind !== "income" && line.differenceCents < 0)
    .sort((a, b) => a.differenceCents - b.differenceCents)
    .slice(0, 3)

  const biggest = overruns[0]
  const [latestAnalysis] = await loadNotes("monthly", 1)
  const firstMove = latestAnalysis?.body
    .split("\n\n")
    .find((paragraph) => paragraph.startsWith("•"))

  return (
    <main className="app stack">
      <div>
        <h1>Money meeting · {formatMonth(view.month, locale)}</h1>
        <p className="muted">
          Everything worth saying about this month, and one thing to decide. Fifteen minutes.
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
        <button type="submit">Show</button>
      </form>

      <section className="tiles">
        <div className="tile">
          <div className="tile-label">Left over</div>
          <div className="tile-value">
            <Money cents={view.summary.netCents} currency={currency} locale={locale} short signed />
          </div>
          <div className="tile-note">Income minus spending minus what was set aside</div>
        </div>
        <div className="tile">
          <div className="tile-label">Set aside</div>
          <div className="tile-value">
            <Money cents={view.summary.savingsCents} currency={currency} locale={locale} short />
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Unexplained</div>
          <div className="tile-value">
            <Money cents={view.summary.unexplainedCents} currency={currency} locale={locale} short />
          </div>
          <div className="tile-note">
            {view.summary.unexplainedCents > 0 ? (
              <Link href="/transactions?filter=unexplained">Worth ten minutes before the meeting</Link>
            ) : (
              "Nothing missing"
            )}
          </div>
        </div>
      </section>

      <section className="split">
        <div className="card">
          <h2>Wins</h2>
          {wins.length === 0 ? (
            <Empty>Nothing came in under plan this month.</Empty>
          ) : (
            <ul>
              {wins.map((line) => (
                <li key={line.categoryId}>
                  <strong>{line.name}</strong> came in{" "}
                  <Money cents={line.differenceCents} currency={currency} locale={locale} short /> under
                  plan.
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Overruns</h2>
          {overruns.length === 0 ? (
            <Empty>Nothing went over plan. Rare and worth saying out loud.</Empty>
          ) : (
            <ul>
              {overruns.map((line) => (
                <li key={line.categoryId}>
                  <strong>{line.name}</strong> went{" "}
                  <Money
                    cents={Math.abs(line.differenceCents)}
                    currency={currency}
                    locale={locale}
                    short
                  />{" "}
                  over a plan of{" "}
                  <Money cents={line.plannedCents} currency={currency} locale={locale} short />.
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card">
        <h2>One decision</h2>
        {biggest ? (
          <p>
            <strong>{biggest.name}</strong> is over by{" "}
            <Money
              cents={Math.abs(biggest.differenceCents)}
              currency={currency}
              locale={locale}
            />
            . Either the plan is wrong or the spending is — decide which, change that one number on
            the <Link href="/budget">budget</Link>, and stop there.
          </p>
        ) : (
          <p>
            Nothing is over plan. The decision this month is whether anything left over should be
            given a job — an amount with no purpose gets spent by default.
          </p>
        )}
        {firstMove ? (
          <Notice>
            The advisor's highest-value move, if you want a second opinion: {firstMove}
          </Notice>
        ) : null}
      </section>
    </main>
  )
}
