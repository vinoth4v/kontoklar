import { aiConfigured } from "@/ai/json"
import { DISCLAIMER } from "@/ai/advisor"
import {
  analyseAction,
  auditAction,
  scenarioAction,
  windfallAction,
} from "@/app/advisor/actions"
import { Empty, Notice } from "@/components/ui"
import { loadNotes } from "@/data/store"
import { loadMonthView } from "@/data/view"
import type { AiNoteRow } from "@/db/schema"
import { formatMonth } from "@/domain/money"

export const dynamic = "force-dynamic"

/**
 * The advisor.
 *
 * Four questions, all answered against this person's real numbers and all
 * ranked by money per year — because an advisor that opens with the €13 coffee
 * habit teaches the user to stop reading, and the €2,400 duplicate policy goes
 * on being paid.
 */
export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; error?: string }>
}) {
  const { month: requested, error } = await searchParams
  const view = await loadMonthView(requested)
  const { locale } = view.settings
  const ai = aiConfigured()

  const [monthly, scenarios, audits, windfalls] = await Promise.all([
    loadNotes("monthly", 6),
    loadNotes("scenario", 6),
    loadNotes("audit", 3),
    loadNotes("windfall", 3),
  ])

  return (
    <main className="app stack">
      <div>
        <h1>Advisor · {formatMonth(view.month, locale)}</h1>
        <p className="muted">{DISCLAIMER}</p>
      </div>

      {error ? <p role="alert">{error}</p> : null}

      {ai ? null : (
        <Notice>
          The model gateway is not configured, so nothing here can be asked. Every other screen works
          without it.
        </Notice>
      )}

      <form className="cluster">
        <div className="field">
          <label htmlFor="month">Month to analyse</label>
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

      <section className="split">
        <div className="card">
          <h2>This month, in plain language</h2>
          <p className="small muted">
            What the month actually shows, and the moves worth making — ranked by what each is worth
            in a year.
          </p>
          <form action={analyseAction} className="actions">
            <input type="hidden" name="month" value={view.month} />
            <button type="submit" disabled={!ai}>
              Analyse {formatMonth(view.month, locale)}
            </button>
          </form>
          <Notes notes={monthly} empty="No analysis yet." locale={locale} />
        </div>

        <div className="card">
          <h2>Ask about a change</h2>
          <p className="small muted">
            "What if my rent rises by 200?" · "Can I afford 400 a month into savings?" — answered
            against your numbers, with the arithmetic shown.
          </p>
          <form action={scenarioAction} className="stack-tight">
            <input type="hidden" name="month" value={view.month} />
            <div className="field">
              <label htmlFor="question">Your question</label>
              <textarea id="question" name="question" required />
            </div>
            <div className="actions">
              <button type="submit" disabled={!ai}>
                Ask
              </button>
            </div>
          </form>
          <Notes notes={scenarios} empty="Nothing asked yet." locale={locale} />
        </div>
      </section>

      <section className="split">
        <div className="card">
          <h2>Annual audit</h2>
          <p className="small muted">
            Duplicate direct debits, subscriptions that died, charges that crept up, and expenses
            worth checking against your country's tax rules.
          </p>
          <form action={auditAction} className="actions">
            <input type="hidden" name="month" value={view.month} />
            <button type="submit" disabled={!ai}>
              Run the audit
            </button>
          </form>
          {view.recurring.length > 0 ? (
            <p className="hint">
              {view.recurring.length} recurring charges detected from your data — found by
              arithmetic, before the model is asked anything.
            </p>
          ) : null}
          <Notes notes={audits} empty="No audit yet." locale={locale} />
        </div>

        <div className="card">
          <h2>Money arriving</h2>
          <p className="small muted">
            A bonus, a refund, freelance income. Decide where it goes before it lands, or it becomes
            consumption within the month.
          </p>
          <form action={windfallAction} className="stack-tight">
            <input type="hidden" name="month" value={view.month} />
            <div className="fields">
              <div className="field">
                <label htmlFor="amount">How much</label>
                <input id="amount" name="amount" inputMode="decimal" required />
              </div>
              <div className="field">
                <label htmlFor="note">What it is</label>
                <input id="note" name="note" placeholder="Annual bonus" />
              </div>
            </div>
            <div className="actions">
              <button type="submit" disabled={!ai}>
                Propose an allocation
              </button>
            </div>
          </form>
          <Notes notes={windfalls} empty="Nothing planned yet." locale={locale} />
        </div>
      </section>
    </main>
  )
}

function Notes({
  notes,
  empty,
  locale,
}: {
  notes: readonly AiNoteRow[]
  empty: string
  locale: string
}) {
  if (notes.length === 0) return <Empty>{empty}</Empty>

  return (
    <div className="stack-tight prose">
      {notes.map((note) => (
        <article key={note.id}>
          <h3>
            {note.question ? note.question : formatMonth(note.subject, locale)}{" "}
            <span className="pill">{note.createdAt.toISOString().slice(0, 10)}</span>
          </h3>
          {note.body.split("\n\n").map((paragraph, index) => (
            // Paragraph order is the identity here: the text is immutable once
            // stored, so the index is a stable key.
            // biome-ignore lint/suspicious/noArrayIndexKey: stored text never reorders
            <p key={index} style={{ whiteSpace: "pre-wrap" }}>
              {paragraph}
            </p>
          ))}
        </article>
      ))}
    </div>
  )
}
