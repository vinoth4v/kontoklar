import Link from "next/link"
import { aiConfigured } from "@/ai/json"
import { importAction } from "@/app/import/actions"
import { Empty, Notice } from "@/components/ui"
import { loadImports, loadWorkspace } from "@/data/store"

export const dynamic = "force-dynamic"

/**
 * Where a statement becomes actuals.
 *
 * No bank connection, deliberately. Live account access in Europe means a
 * licensed aggregator, a contract and a compliance surface; a CSV export gets
 * the same numbers into the same place today. What that costs the user is one
 * download a month, and it is written on this page rather than hidden.
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; error?: string }>
}) {
  const { batch, error } = await searchParams
  const [workspace, imports] = await Promise.all([loadWorkspace(), loadImports()])
  const ai = aiConfigured()
  const latest = batch ? imports.find((row) => row.id === batch) : undefined
  const accountName = new Map(workspace.accounts.map((account) => [account.id, account.name]))

  return (
    <main className="app stack">
      <div>
        <h1>Import a statement</h1>
        <p className="muted">
          A CSV export from any bank, or a PDF statement. Columns are recognised automatically where
          possible and the model is asked only when they cannot be — so a familiar export costs
          nothing to import.
        </p>
      </div>

      {error ? <p role="alert">{error}</p> : null}

      {latest ? (
        <Notice>
          <strong>{latest.filename}</strong>: {latest.parsedRows} rows read, {latest.importedRows}{" "}
          imported, {latest.duplicateRows} already there. Read with the {latest.parser} parser.
          {latest.note ? ` ${latest.note}` : ""}{" "}
          <Link href="/transactions?filter=unexplained">See what is still unexplained</Link>.
        </Notice>
      ) : null}

      {workspace.accounts.length === 0 ? (
        <Empty>
          There is no account to import into yet. <Link href="/accounts">Add one</Link>.
        </Empty>
      ) : (
        <section className="card">
          <form action={importAction} className="stack-tight">
            <div className="fields">
              <div className="field">
                <label htmlFor="accountId">Which account</label>
                <select id="accountId" name="accountId" required>
                  {workspace.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="statement">File</label>
                <input id="statement" name="statement" type="file" accept=".csv,.txt,.pdf" required />
              </div>
              <div className="field">
                <label htmlFor="useAi">
                  <input
                    id="useAi"
                    name="useAi"
                    type="checkbox"
                    defaultChecked={ai}
                    disabled={!ai}
                    style={{ width: "auto" }}
                  />{" "}
                  Use AI for unknown columns and categorising
                </label>
                <span className="hint">
                  {ai
                    ? "Off means rules only: known columns are still read, and anything uncategorised waits for you."
                    : "The model gateway is not configured, so this import is rules-only. CSV still works; PDF does not."}
                </span>
              </div>
            </div>
            <div className="actions">
              <button type="submit">Import</button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <h2>What happens to it</h2>
        <ul className="small">
          <li>
            Rows with no readable date or amount are counted and skipped, never imported as a zero.
          </li>
          <li>
            Re-importing the same statement is safe: every line carries a fingerprint, so duplicates
            are refused rather than doubled — and two genuinely identical purchases on one day both
            survive.
          </li>
          <li>
            Transfers between your own accounts are paired and excluded from spending, so moving
            money is not counted twice.
          </li>
          <li>
            A payment that settles a credit card is matched against that card's charges. Whatever it
            covers that no charge explains becomes an unexplained line — the difference is never
            dropped.
          </li>
          <li>Your own corrections are applied before anything is sent to a model.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Earlier imports</h2>
        {imports.length === 0 ? (
          <p className="muted small">Nothing imported yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Account</th>
                  <th>Parser</th>
                  <th className="num">Read</th>
                  <th className="num">Imported</th>
                  <th className="num">Duplicates</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((row) => (
                  <tr key={row.id}>
                    <td>{row.filename}</td>
                    <td className="muted small">
                      {row.accountId ? (accountName.get(row.accountId) ?? "—") : "—"}
                    </td>
                    <td className="muted small">{row.parser}</td>
                    <td className="num">{row.parsedRows}</td>
                    <td className="num">{row.importedRows}</td>
                    <td className="num">{row.duplicateRows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
