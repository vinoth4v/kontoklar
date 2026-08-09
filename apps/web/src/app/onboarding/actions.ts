"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { draftFromAnswers, draftFromStatement } from "@/ai/budget"
import { AiUnavailable } from "@/ai/json"
import { extractFromText, mapColumnsWithAi } from "@/ai/parse"
import { applyDraft, createAccount } from "@/data/setup"
import { saveSettings } from "@/data/store"
import { ACCOUNT_KINDS } from "@/db/schema"
import { recordEvent } from "@/db/events"
import { applyColumnMap, guessColumns, type ParsedLine, parseCsv } from "@/domain/csv"
import { monthOf, parseAmountToCents } from "@/domain/money"
import { extractPdfText } from "@/domain/pdf"

/**
 * Getting from nothing to a working plan.
 *
 * All three routes end in the same place — an account and a set of categories
 * the user can edit — because the difference between them is only where the
 * first draft came from, and none of them is allowed to be a dead end.
 */

const accountFields = z.object({
  accountName: z.string().min(1).max(80),
  accountKind: z.enum(ACCOUNT_KINDS),
  currency: z.string().min(3).max(3),
  openingBalance: z.string().optional(),
})

const settingsFields = z.object({
  householdName: z.string().min(1).max(80),
  country: z.string().min(2).max(2),
  locale: z.string().min(2).max(10),
})

function fail(message: string): never {
  redirect(`/onboarding?error=${encodeURIComponent(message)}`)
}

async function makeFirstAccount(form: FormData): Promise<{ id: string; currency: string }> {
  const parsed = accountFields.safeParse({
    accountName: form.get("accountName"),
    accountKind: form.get("accountKind"),
    currency: String(form.get("currency") ?? "EUR").toUpperCase(),
    openingBalance: form.get("openingBalance") ?? "",
  })
  if (!parsed.success) fail("An account needs a name, a kind and a three-letter currency.")

  const id = await createAccount({
    name: parsed.data.accountName,
    kind: parsed.data.accountKind,
    currency: parsed.data.currency,
    openingBalanceCents: parseAmountToCents(parsed.data.openingBalance ?? "") ?? 0,
  })

  return { id, currency: parsed.data.currency }
}

async function storeSettings(form: FormData, currency: string): Promise<void> {
  const parsed = settingsFields.safeParse({
    householdName: form.get("householdName"),
    country: String(form.get("country") ?? "DE").toUpperCase(),
    locale: form.get("locale"),
  })
  if (!parsed.success) fail("Tell it what to call your money, and where you live.")

  await saveSettings({ ...parsed.data, currency })
}

/** The route for someone who wants no help at all. */
export async function startManualAction(form: FormData): Promise<void> {
  const { currency } = await makeFirstAccount(form)
  await storeSettings(form, currency)
  await recordEvent("account_changed", null, "first account created manually")
  revalidatePath("/")
  redirect("/budget")
}

export async function draftFromAnswersAction(form: FormData): Promise<void> {
  const { currency } = await makeFirstAccount(form)
  await storeSettings(form, currency)

  const answers = {
    householdName: String(form.get("householdName") ?? ""),
    country: String(form.get("country") ?? ""),
    currency,
    earners: String(form.get("earners") ?? ""),
    netIncome: String(form.get("netIncome") ?? ""),
    housing: String(form.get("housing") ?? ""),
    housingCost: String(form.get("housingCost") ?? ""),
    commitments: String(form.get("commitments") ?? ""),
    goals: String(form.get("goals") ?? ""),
  }

  const month = monthOf(new Date().toISOString().slice(0, 10))

  try {
    const draft = await draftFromAnswers(answers)
    const created = await applyDraft(draft, month)
    await recordEvent("budget_changed", null, `${created} categories drafted from answers`)
  } catch (error) {
    // The account and settings are already saved, so this is a partial
    // success, not a failure — say so and let them continue by hand.
    fail(
      error instanceof AiUnavailable
        ? `Your account is set up, but the budget draft failed: ${error.message}. Add categories yourself on the budget page.`
        : "Your account is set up, but the budget draft failed. Add categories yourself on the budget page.",
    )
  }

  revalidatePath("/")
  redirect("/budget?drafted=1")
}

export async function draftFromStatementAction(form: FormData): Promise<void> {
  const file = form.get("statement")
  if (!(file instanceof File) || file.size === 0) fail("Choose a statement file first.")

  const { currency } = await makeFirstAccount(form)
  await storeSettings(form, currency)

  const country = String(form.get("country") ?? "DE").toUpperCase()
  const bytes = new Uint8Array(await file.arrayBuffer())

  let lines: ParsedLine[] = []
  // Collected rather than thrown: `redirect` works by throwing, so calling it
  // inside a try block would be swallowed by this function's own catch.
  let problem: string | null = null

  try {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const text = extractPdfText(bytes)
      if (text.length < 80) {
        problem = "Your account is set up, but no text could be read from that PDF. A CSV export works better."
      } else {
        lines = (await extractFromText(text)).lines
      }
    } else {
      const table = parseCsv(new TextDecoder("utf-8").decode(bytes))
      const map = guessColumns(table.headers) ?? (await mapColumnsWithAi(table))
      if (!map) {
        problem = "Your account is set up, but the columns in that file could not be recognised."
      } else {
        lines = applyColumnMap(table.rows, map).lines
      }
    }
  } catch (error) {
    problem =
      error instanceof AiUnavailable
        ? `Your account is set up, but the statement could not be read: ${error.message}.`
        : "Your account is set up, but the statement could not be read. Try a CSV export."
  }

  if (problem) fail(problem)
  if (lines.length === 0) fail("Your account is set up, but no transactions were found in that file.")

  const month = monthOf(new Date().toISOString().slice(0, 10))

  try {
    const draft = await draftFromStatement(lines, currency, country)
    const created = await applyDraft(draft, month)
    await recordEvent("budget_changed", null, `${created} categories drafted from a statement`)
  } catch (error) {
    fail(
      error instanceof AiUnavailable
        ? `Your account is set up, but the budget draft failed: ${error.message}.`
        : "Your account is set up, but the budget draft failed.",
    )
  }

  revalidatePath("/")
  // The statement itself is deliberately not imported here: the import screen
  // shows what would be created and what is a duplicate, and skipping that on
  // the very first upload is how a person ends up with a ledger they did not
  // agree to.
  redirect("/budget?drafted=1&import=1")
}
