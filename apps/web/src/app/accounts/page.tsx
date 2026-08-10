import {
  archiveAccountAction,
  createAccountAction,
  updateAccountAction,
} from "@/app/accounts/actions"
import { Empty, FlowDiagram, Money } from "@/components/ui"
import { loadMonthView } from "@/data/view"
import { ACCOUNT_KINDS } from "@/db/schema"
import { centsToInput } from "@/domain/money"

export const dynamic = "force-dynamic"

/**
 * Accounts, their balances, and the one relationship that matters: which
 * account settles which card. That link is what lets a card payment stop
 * counting as spending twice.
 */
export default async function AccountsPage() {
  const view = await loadMonthView()
  const { currency, locale } = view.settings
  const cards = view.accounts.filter((account) => account.kind === "credit_card")

  return (
    <main className="app stack">
      <div>
        <h1>Accounts</h1>
        <p className="muted">
          Every account money sits in or passes through. Tell a credit card which account pays it off
          and its charges will be counted in the month they were made, not the month the bill landed.
        </p>
      </div>

      {view.accounts.length === 0 ? (
        <Empty>No accounts yet.</Empty>
      ) : (
        <section className="stack">
          {view.accounts.map((account) => (
            <div className="card" key={account.id}>
              <div className="cluster" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>
                  {account.name}{" "}
                  {account.archivedAt ? <span className="pill">archived</span> : null}
                </h2>
                <strong>
                  <Money
                    cents={view.balances.get(account.id) ?? 0}
                    currency={account.currency}
                    locale={locale}
                    signed
                  />
                </strong>
              </div>

              <form action={updateAccountAction} className="stack-tight">
                <input type="hidden" name="id" value={account.id} />
                <div className="fields">
                  <div className="field">
                    <label htmlFor={`name-${account.id}`}>Name</label>
                    <input id={`name-${account.id}`} name="name" defaultValue={account.name} required />
                  </div>
                  <div className="field">
                    <label htmlFor={`kind-${account.id}`}>Kind</label>
                    <select id={`kind-${account.id}`} name="kind" defaultValue={account.kind}>
                      {ACCOUNT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`institution-${account.id}`}>Bank</label>
                    <input
                      id={`institution-${account.id}`}
                      name="institution"
                      defaultValue={account.institution ?? ""}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`owner-${account.id}`}>Whose</label>
                    <input
                      id={`owner-${account.id}`}
                      name="owner"
                      defaultValue={account.owner ?? ""}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`currency-${account.id}`}>Currency</label>
                    <input
                      id={`currency-${account.id}`}
                      name="currency"
                      defaultValue={account.currency}
                      maxLength={3}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`opening-${account.id}`}>Opening balance</label>
                    <input
                      id={`opening-${account.id}`}
                      name="openingBalance"
                      inputMode="decimal"
                      defaultValue={centsToInput(account.openingBalanceCents)}
                    />
                  </div>
                  {account.kind === "credit_card" ? (
                    <div className="field">
                      <label htmlFor={`settles-${account.id}`}>Paid off from</label>
                      <select
                        id={`settles-${account.id}`}
                        name="settlementAccountId"
                        defaultValue={account.settlementAccountId ?? ""}
                      >
                        <option value="">Not linked</option>
                        {view.accounts
                          .filter((other) => other.id !== account.id && other.kind !== "credit_card")
                          .map((other) => (
                            <option key={other.id} value={other.id}>
                              {other.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : null}
                </div>
                <div className="actions">
                  <button type="submit">Save</button>
                </div>
              </form>

              <form action={archiveAccountAction} className="actions">
                <input type="hidden" name="id" value={account.id} />
                <button className="quiet" type="submit">
                  {account.archivedAt ? "Restore" : "Archive"}
                </button>
                <span className="hint">
                  Archiving hides the account and keeps every transaction it carries.
                </span>
              </form>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>Add an account</h2>
        <form action={createAccountAction} className="stack-tight">
          <div className="fields">
            <div className="field">
              <label htmlFor="new-name">Name</label>
              <input id="new-name" name="name" required />
            </div>
            <div className="field">
              <label htmlFor="new-kind">Kind</label>
              <select id="new-kind" name="kind" defaultValue="checking">
                {ACCOUNT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="new-institution">Bank</label>
              <input id="new-institution" name="institution" />
            </div>
            <div className="field">
              <label htmlFor="new-owner">Whose</label>
              <input id="new-owner" name="owner" placeholder="Optional" />
            </div>
            <div className="field">
              <label htmlFor="new-currency">Currency</label>
              <input id="new-currency" name="currency" defaultValue={currency} maxLength={3} required />
            </div>
            <div className="field">
              <label htmlFor="new-opening">Opening balance</label>
              <input id="new-opening" name="openingBalance" inputMode="decimal" placeholder="0" />
            </div>
            <div className="field">
              <label htmlFor="new-settles">Paid off from (cards only)</label>
              <select id="new-settles" name="settlementAccountId" defaultValue="">
                <option value="">Not linked</option>
                {view.accounts
                  .filter((other) => other.kind !== "credit_card")
                  .map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="actions">
            <button type="submit">Add account</button>
          </div>
        </form>
      </section>

      {cards.length > 0 && cards.every((card) => !card.settlementAccountId) ? (
        <p className="notice">
          You have a credit card with no settlement account. Until it is linked, the payment that
          clears the card looks like ordinary spending and the month is counted twice.
        </p>
      ) : null}

      {view.flows.length > 0 ? (
        <section className="card">
          <h2>Money flow</h2>
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
