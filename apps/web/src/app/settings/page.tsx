import { aiConfigured } from "@/ai/json"
import { DISCLAIMER } from "@/ai/advisor"
import { deleteEverythingAction, saveSettingsAction } from "@/app/settings/actions"
import { Notice } from "@/components/ui"
import { loadRules, loadSettings, loadWorkspace } from "@/data/store"
import { PRESETS } from "@/domain/locale"

export const dynamic = "force-dynamic"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>
}) {
  const { saved, error } = await searchParams
  const [settings, workspace, rules] = await Promise.all([
    loadSettings(),
    loadWorkspace(),
    loadRules(),
  ])
  const categoryName = new Map(workspace.categories.map((category) => [category.id, category.name]))

  return (
    <main className="app stack">
      <h1>Settings</h1>

      {error ? <p role="alert">{error}</p> : null}
      {saved ? <Notice>Saved.</Notice> : null}

      <section className="card">
        <h2>Where you are</h2>
        <p className="small muted">
          Changes how money and dates are written everywhere, and which tax system the advisor
          reasons about. It does not convert anything: amounts are stored in the currency of the
          account they belong to.
        </p>
        <form action={saveSettingsAction} className="stack-tight">
          <div className="fields">
            <div className="field">
              <label htmlFor="householdName">What to call your money</label>
              <input
                id="householdName"
                name="householdName"
                defaultValue={settings.householdName}
                maxLength={80}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="country">Country</label>
              <select id="country" name="country" defaultValue={settings.country}>
                {PRESETS.map((preset) => (
                  <option key={preset.country} value={preset.country}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <input
                id="currency"
                name="currency"
                defaultValue={settings.currency}
                maxLength={3}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="locale">Number and date format</label>
              <input id="locale" name="locale" defaultValue={settings.locale} required />
            </div>
          </div>
          <div className="actions">
            <button type="submit">Save</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>What it learned from you</h2>
        {rules.length === 0 ? (
          <p className="muted small">
            No rules yet. Correcting a category on the transactions screen creates one, and it is
            applied to everything it explains — past and future.
          </p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>When the payee looks like</th>
                  <th>Use</th>
                  <th className="num">Applied</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.matcher}</td>
                    <td>{categoryName.get(rule.categoryId) ?? "—"}</td>
                    <td className="num">{rule.hits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="small muted">
          Everything is exportable and everything is deletable. No lock-in is not a feature; it is
          the minimum.
        </p>
        <p className="actions">
          <a href="/api/export">Download everything as JSON</a>
          <a href="/api/export?format=csv">Download transactions as CSV</a>
        </p>
        <form action={deleteEverythingAction} className="stack-tight">
          <div className="field">
            <label htmlFor="confirm">Type "delete" to erase every account, transaction, budget and rule</label>
            <input id="confirm" name="confirm" autoComplete="off" />
          </div>
          <div className="actions">
            <button className="danger" type="submit">
              Delete everything
            </button>
            <span className="hint">
              Immediate and irreversible. Your login is unaffected — it lives in the environment,
              not in the database.
            </span>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>About the AI</h2>
        <p className="small">{DISCLAIMER}</p>
        <p className="small muted">
          Requests go to the Kompass gateway, which is {aiConfigured() ? "configured" : "not configured"}.
          It is sent aggregates — category names, planned and actual totals, and the payee fragments
          of recurring charges — and never your full transaction list. Every screen works without
          it.
        </p>
      </section>
    </main>
  )
}
