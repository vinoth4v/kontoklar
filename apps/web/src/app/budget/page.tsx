import Link from "next/link"
import {
  archiveCategoryAction,
  copyPreviousMonthAction,
  createCategoryAction,
  createGroupAction,
  savePlanAction,
} from "@/app/budget/actions"
import { Bar, Empty, Money, Notice } from "@/components/ui"
import { loadMonthView } from "@/data/view"
import { CATEGORY_KINDS } from "@/db/schema"
import { centsToInput, formatMonth } from "@/domain/money"

export const dynamic = "force-dynamic"

/**
 * The plan, beside what actually happened.
 *
 * Deliberately not a separate "budget" screen and "report" screen: the number
 * you are about to change is only meaningful next to the number it produced
 * last time.
 */
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; drafted?: string; import?: string }>
}) {
  const { month: requested, drafted, import: cameFromStatement } = await searchParams
  const view = await loadMonthView(requested)
  const { currency, locale } = view.settings

  const actual = new Map(view.variance.map((line) => [line.categoryId, line]))
  const open = view.categories.filter((category) => !category.archivedAt)
  const archived = view.categories.filter((category) => category.archivedAt)
  const ungrouped = open.filter((category) => !category.groupId)

  const totals = {
    income: sum(open, "income", view.planned),
    expense: sum(open, "expense", view.planned),
    savings: sum(open, "savings", view.planned),
  }
  const leftToPlan = totals.income - totals.expense - totals.savings

  return (
    <main className="app stack">
      <div className="cluster" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Budget · {formatMonth(view.month, locale)}</h1>
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

      {drafted ? (
        <Notice>
          Your draft is below. Every line is a guess made from what you told it — change anything
          that is wrong, and delete anything that is not you.
          {cameFromStatement ? (
            <>
              {" "}
              The statement you uploaded was read but not imported.{" "}
              <Link href="/import">Import it now</Link> to fill in the actuals.
            </>
          ) : null}
        </Notice>
      ) : null}

      {open.length === 0 ? (
        <Empty>
          No categories yet. Add the first one below — there is no default set, deliberately.
        </Empty>
      ) : (
        <section className="card">
          <form action={savePlanAction} className="stack-tight">
            <input type="hidden" name="month" value={view.month} />
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Planned</th>
                    <th className="num">Actual</th>
                    <th className="num">Difference</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {view.groups.map((group) => {
                    const inGroup = open.filter((category) => category.groupId === group.id)
                    if (inGroup.length === 0) return null
                    return (
                      <Rows
                        key={group.id}
                        title={group.name}
                        categories={inGroup}
                        planned={view.planned}
                        actual={actual}
                        currency={currency}
                        locale={locale}
                      />
                    )
                  })}
                  {ungrouped.length > 0 ? (
                    <Rows
                      title="Ungrouped"
                      categories={ungrouped}
                      planned={view.planned}
                      actual={actual}
                      currency={currency}
                      locale={locale}
                    />
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button type="submit">Save the plan</button>
              <span className="hint">
                Planned income <Money cents={totals.income} currency={currency} locale={locale} short /> ·
                planned spending <Money cents={totals.expense} currency={currency} locale={locale} short /> ·
                planned saving <Money cents={totals.savings} currency={currency} locale={locale} short /> ·
                left to plan <Money cents={leftToPlan} currency={currency} locale={locale} short signed />
              </span>
            </div>
          </form>

          <form action={copyPreviousMonthAction} className="actions">
            <input type="hidden" name="month" value={view.month} />
            <button className="quiet" type="submit">
              Copy last month's plan into this one
            </button>
          </form>
        </section>
      )}

      <section className="split">
        <div className="card">
          <h2>Add a category</h2>
          <form action={createCategoryAction} className="stack-tight">
            <input type="hidden" name="month" value={view.month} />
            <div className="fields">
              <div className="field">
                <label htmlFor="cat-name">Name</label>
                <input id="cat-name" name="name" required />
              </div>
              <div className="field">
                <label htmlFor="cat-kind">Kind</label>
                <select id="cat-kind" name="kind" defaultValue="expense">
                  {CATEGORY_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cat-group">Group</label>
                <select id="cat-group" name="groupId" defaultValue="">
                  <option value="">No group</option>
                  {view.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cat-planned">Planned this month</label>
                <input id="cat-planned" name="planned" inputMode="decimal" placeholder="0" />
              </div>
              <div className="field">
                <label htmlFor="cat-visibility">Visibility</label>
                <select id="cat-visibility" name="visibility" defaultValue="shared">
                  <option value="shared">Shared</option>
                  <option value="private">Private</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="cat-fixed">
                  <input id="cat-fixed" name="fixedCost" type="checkbox" style={{ width: "auto" }} />{" "}
                  Committed cost
                </label>
                <span className="hint">Counts toward your fixed-cost share.</span>
              </div>
            </div>
            <div className="actions">
              <button type="submit">Add category</button>
            </div>
          </form>
          <p className="hint">
            Private categories are recorded as private, but with one login everything is still
            visible here — see the README on what sharing does and does not do yet.
          </p>
        </div>

        <div className="card">
          <h2>Groups</h2>
          <p className="small muted">
            {view.groups.length === 0
              ? "No groups yet. They are optional — a flat list of categories is a perfectly good budget."
              : view.groups.map((group) => group.name).join(" · ")}
          </p>
          <form action={createGroupAction} className="cluster">
            <div className="field">
              <label htmlFor="group-name">New group</label>
              <input id="group-name" name="name" required />
            </div>
            <button type="submit">Add</button>
          </form>

          {archived.length > 0 ? (
            <>
              <h3 style={{ marginTop: "1.5rem" }}>Archived</h3>
              <ul className="small">
                {archived.map((category) => (
                  <li key={category.id}>
                    {category.name}{" "}
                    <form action={archiveCategoryAction} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={category.id} />
                      <button className="quiet" type="submit">
                        Restore
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </section>
    </main>
  )
}

type Line = { categoryId: string; plannedCents: number; actualCents: number; differenceCents: number; ratio: number | null }

function Rows({
  title,
  categories,
  planned,
  actual,
  currency,
  locale,
}: {
  title: string
  categories: readonly { id: string; name: string; kind: string; fixedCost: boolean }[]
  planned: ReadonlyMap<string, number>
  actual: ReadonlyMap<string, Line>
  currency: string
  locale: string
}) {
  return (
    <>
      <tr>
        <th colSpan={5}>{title}</th>
      </tr>
      {categories.map((category) => {
        const line = actual.get(category.id)
        return (
          <tr key={category.id}>
            <td>
              {category.name}{" "}
              {category.fixedCost ? <span className="pill">fixed</span> : null}{" "}
              <span className="muted small">{category.kind}</span>
              <Bar ratio={line?.ratio ?? null} />
            </td>
            <td>
              <input
                name={`planned-${category.id}`}
                inputMode="decimal"
                defaultValue={centsToInput(planned.get(category.id) ?? 0)}
                aria-label={`Planned for ${category.name}`}
              />
            </td>
            <td className="num">
              <Money cents={line?.actualCents ?? 0} currency={currency} locale={locale} short />
            </td>
            <td className="num">
              <Money cents={line?.differenceCents ?? 0} currency={currency} locale={locale} short signed />
            </td>
            <td>
              {/* `formAction` rather than a nested form: this row lives inside
                  the plan's own form, and a form inside a form is invalid HTML
                  that browsers resolve by dropping one of them. */}
              <button
                className="quiet"
                type="submit"
                name="id"
                value={category.id}
                formAction={archiveCategoryAction}
              >
                Archive
              </button>
            </td>
          </tr>
        )
      })}
    </>
  )
}

function sum(
  categories: readonly { id: string; kind: string }[],
  kind: string,
  planned: ReadonlyMap<string, number>,
): number {
  return categories
    .filter((category) => category.kind === kind)
    .reduce((total, category) => total + (planned.get(category.id) ?? 0), 0)
}
