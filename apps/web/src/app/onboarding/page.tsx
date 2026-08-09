import { redirect } from "next/navigation"
import {
  draftFromAnswersAction,
  draftFromStatementAction,
  startManualAction,
} from "@/app/onboarding/actions"
import { aiConfigured } from "@/ai/json"
import { Notice } from "@/components/ui"
import { isConfigured } from "@/data/store"
import { ACCOUNT_KINDS } from "@/db/schema"
import { PRESETS } from "@/domain/locale"

export const dynamic = "force-dynamic"

/**
 * Ten minutes, three ways in.
 *
 * The questions are the ones a person can answer without looking anything up.
 * The statement route is the honest one — a plan built from what is already
 * happening — and the manual route exists because an app that cannot be used
 * without an AI call is an app that stops working when the gateway does.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await isConfigured()) redirect("/")

  const { error } = await searchParams
  const ai = aiConfigured()

  return (
    <main className="app stack">
      <div>
        <h1>Set up Kontoklar</h1>
        <p className="muted">
          One account and a handful of categories is enough to start. Nothing here is fixed
          afterwards — categories, accounts and plans are all yours to rename, split or delete.
        </p>
      </div>

      {error ? <p role="alert">{error}</p> : null}

      {ai ? null : (
        <Notice>
          The model gateway is not configured, so the two drafting routes are unavailable. Setting up
          by hand below works exactly as well; every screen in this app is usable without AI.
        </Notice>
      )}

      <section className="card">
        <h2>Answer a few questions</h2>
        <p className="muted small">
          A working plan from a conversation instead of an empty grid. You can change every line
          afterwards.
        </p>
        <form action={draftFromAnswersAction} className="stack-tight">
          <AccountFields prefix="questions" />
          <fieldset>
            <legend>About your money</legend>
            <div className="fields">
              <div className="field">
                <label htmlFor="earners">Who earns</label>
                <input id="earners" name="earners" placeholder="Just me / two of us" required />
              </div>
              <div className="field">
                <label htmlFor="netIncome">Monthly net income</label>
                <input id="netIncome" name="netIncome" placeholder="3200" required />
              </div>
              <div className="field">
                <label htmlFor="housing">Rent or own</label>
                <input id="housing" name="housing" placeholder="Renting a flat" required />
              </div>
              <div className="field">
                <label htmlFor="housingCost">Housing costs a month</label>
                <input id="housingCost" name="housingCost" placeholder="1100 including bills" required />
              </div>
            </div>
            <div className="fields" style={{ marginTop: "1rem" }}>
              <div className="field">
                <label htmlFor="commitments">Regular commitments</label>
                <textarea
                  id="commitments"
                  name="commitments"
                  placeholder="Insurance, phone, gym, a loan…"
                />
              </div>
              <div className="field">
                <label htmlFor="goals">What you want from this</label>
                <textarea id="goals" name="goals" placeholder="Save something every month, stop losing track of cards…" />
              </div>
            </div>
          </fieldset>
          <div className="actions">
            <button type="submit" disabled={!ai}>
              Draft my budget
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Start from a statement</h2>
        <p className="muted small">
          Upload one bank statement — CSV from any bank, or a PDF — and the budget is drafted from
          what your money actually did. The transactions themselves are not imported yet; that
          happens on the import screen where you can see what it found first.
        </p>
        <form action={draftFromStatementAction} className="stack-tight">
          <AccountFields prefix="statement" />
          <div className="field">
            <label htmlFor="statement">Statement</label>
            <input id="statement" name="statement" type="file" accept=".csv,.txt,.pdf" required />
          </div>
          <div className="actions">
            <button type="submit" disabled={!ai}>
              Draft from this statement
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Set it up myself</h2>
        <p className="muted small">
          Creates the account and takes you to the budget screen with nothing in it.
        </p>
        <form action={startManualAction} className="stack-tight">
          <AccountFields prefix="manual" />
          <div className="actions">
            <button className="quiet" type="submit">
              Create the account
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

/**
 * The same four fields on all three forms. Repeated markup rather than a
 * shared multi-step wizard: three independent forms cannot leave a half-filled
 * session behind, and each one is a single submit.
 */
function AccountFields({ prefix }: { prefix: string }) {
  // Three forms on one page means three sets of these, so every id is
  // namespaced — duplicate ids would silently bind each label to the first
  // form's field and make the other two unusable with a screen reader.
  const id = (name: string) => `${prefix}-${name}`

  return (
    <fieldset>
      <legend>You and your first account</legend>
      <div className="fields">
        <div className="field">
          <label htmlFor={id("householdName")}>What to call your money</label>
          <input
            id={id("householdName")}
            name="householdName"
            defaultValue="My money"
            maxLength={80}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={id("country")}>Where you live</label>
          <select id={id("country")} name="country" defaultValue="DE">
            {PRESETS.map((preset) => (
              <option key={preset.country} value={preset.country}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id("currency")}>Currency</label>
          <input id={id("currency")} name="currency" defaultValue="EUR" maxLength={3} required />
        </div>
        <div className="field">
          <label htmlFor={id("locale")}>Number and date format</label>
          <select id={id("locale")} name="locale" defaultValue="de-DE">
            {PRESETS.map((preset) => (
              <option key={preset.locale} value={preset.locale}>
                {preset.locale}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id("accountName")}>Account name</label>
          <input id={id("accountName")} name="accountName" placeholder="Current account" required />
        </div>
        <div className="field">
          <label htmlFor={id("accountKind")}>Kind</label>
          <select id={id("accountKind")} name="accountKind" defaultValue="checking">
            {ACCOUNT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id("openingBalance")}>Balance today</label>
          <input
            id={id("openingBalance")}
            name="openingBalance"
            inputMode="decimal"
            placeholder="0"
          />
        </div>
      </div>
    </fieldset>
  )
}
