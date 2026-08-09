import { auth } from "@/auth"
import { db } from "@/db/client"
import {
  account,
  aiNote,
  appSetting,
  budgetLine,
  category,
  categoryGroup,
  categoryRule,
  importBatch,
  txn,
} from "@/db/schema"
import { recordEvent } from "@/db/events"

export const dynamic = "force-dynamic"

/**
 * Everything, in one file.
 *
 * The proxy already refuses this route without a session; the check is
 * repeated here anyway, because a data export is the one endpoint where a
 * mistake in a matcher pattern would be unrecoverable rather than merely
 * embarrassing.
 *
 * JSON rather than CSV because this is the "I am leaving" export and it has to
 * be complete — every table, every column, including the rules the user taught
 * and the advice they were given. `format=csv` returns just the transactions,
 * for the far more common case of wanting them in a spreadsheet.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user) return new Response("Unauthorised", { status: 401 })

  const [accounts, groups, categories, budget, transactions, rules, imports, notes, settings] =
    await Promise.all([
      db().select().from(account),
      db().select().from(categoryGroup),
      db().select().from(category),
      db().select().from(budgetLine),
      db().select().from(txn),
      db().select().from(categoryRule),
      db().select().from(importBatch),
      db().select().from(aiNote),
      db().select().from(appSetting),
    ])

  await recordEvent("data_exported", session.user.email ?? null, `${transactions.length} transactions`)

  const wantsCsv = new URL(request.url).searchParams.get("format") === "csv"
  const stamp = new Date().toISOString().slice(0, 10)

  if (wantsCsv) {
    const names = new Map(categories.map((row) => [row.id, row.name]))
    const accountNames = new Map(accounts.map((row) => [row.id, row.name]))
    const header = "spent_on,booked_on,account,description,counterparty,amount_cents,category,role,source"
    const lines = transactions.map((row) =>
      [
        row.spentOn,
        row.bookedOn,
        accountNames.get(row.accountId) ?? "",
        row.description,
        row.counterparty ?? "",
        String(row.amountCents),
        row.categoryId ? (names.get(row.categoryId) ?? "") : "",
        row.role,
        row.source,
      ]
        .map(csvField)
        .join(","),
    )

    return new Response([header, ...lines].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="kontoklar-transactions-${stamp}.csv"`,
      },
    })
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    settings,
    accounts,
    groups,
    categories,
    budget,
    transactions,
    rules,
    imports,
    notes,
  }

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="kontoklar-${stamp}.json"`,
    },
  })
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
