import { z } from "zod"
import { askJson } from "@/ai/json"
import type { ColumnMap, CsvTable, ParsedLine } from "@/domain/csv"
import { parseAmountToCents, parseDate } from "@/domain/money"

/**
 * The model as a fallback parser, not the parser.
 *
 * Heuristics map the columns of most bank CSVs for free. When they cannot, the
 * model is shown the header row and two sample rows — never the whole file —
 * and asked only which column is which. The rows themselves are still parsed
 * by code, so a thousand-row statement costs one small call and no transaction
 * ever depends on a model transcribing a number correctly.
 *
 * PDFs are the exception: there are no columns to map, so the extracted text
 * is read directly. That is the expensive path and the least reliable one, and
 * the import screen says as much before the user commits to it.
 */

const columnAnswer = z.object({
  date: z.string(),
  valueDate: z.string().nullable().optional(),
  description: z.string(),
  counterparty: z.string().nullable().optional(),
  amount: z.string().nullable().optional(),
  debit: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
})

export async function mapColumnsWithAi(
  table: CsvTable,
  signal?: AbortSignal,
): Promise<ColumnMap | null> {
  if (table.headers.length === 0) return null

  const samples = table.rows
    .slice(0, 3)
    .map((row) => table.headers.map((header) => `${header}=${row[header]}`).join(" | "))
    .join("\n")

  const answer = await askJson(
    [
      "This is a bank statement export. Say which column holds which field.",
      "",
      `Columns: ${table.headers.join(" | ")}`,
      "",
      "Sample rows:",
      samples,
      "",
      'Answer as {"date":"<column>","valueDate":"<column>"|null,"description":"<column>","counterparty":"<column>"|null,"amount":"<column>"|null,"debit":"<column>"|null,"credit":"<column>"|null}.',
      "Use amount when one column carries a signed value; use debit and credit when outgoing and incoming are separate columns.",
      "Every value must be one of the column names exactly, or null.",
    ].join("\n"),
    columnAnswer,
    { lane: "kompass-fast", maxTokens: 512, signal },
  )

  const known = new Set(table.headers)
  const pick = (value: string | null | undefined): string | undefined =>
    value && known.has(value) ? value : undefined

  const date = pick(answer.date)
  const amount = pick(answer.amount)
  const debit = pick(answer.debit)
  const credit = pick(answer.credit)

  if (!date) return null
  if (!amount && !(debit && credit)) return null

  return {
    date,
    valueDate: pick(answer.valueDate),
    description: pick(answer.description) ?? date,
    counterparty: pick(answer.counterparty),
    amount,
    debit,
    credit,
  }
}

const extracted = z.object({
  transactions: z.array(
    z.object({
      date: z.string(),
      valueDate: z.string().nullable().optional(),
      description: z.string(),
      counterparty: z.string().nullable().optional(),
      amount: z.string(),
    }),
  ),
})

/**
 * Read transactions out of statement text — the PDF path.
 *
 * Amounts and dates come back as the strings they appeared as and are parsed
 * by the same code that parses CSVs, so a German `1.234,56-` behaves
 * identically whichever file it arrived in. Anything that fails to parse is
 * dropped and counted, never imported as a zero.
 */
export async function extractFromText(
  text: string,
  signal?: AbortSignal,
): Promise<{ lines: ParsedLine[]; rejected: number }> {
  const trimmed = text.slice(0, 60_000)

  const answer = await askJson(
    [
      "Extract every transaction from this bank statement text.",
      "",
      "Keep amounts and dates exactly as written in the document — do not reformat, do not convert separators, do not fix what looks wrong. Signs matter: money leaving the account is negative.",
      "Skip balances, subtotals, page headers and footers. Only real transactions.",
      "",
      "---",
      trimmed,
      "---",
      "",
      'Answer as {"transactions":[{"date":"...","valueDate":"..."|null,"description":"...","counterparty":"..."|null,"amount":"..."}]}.',
    ].join("\n"),
    extracted,
    { lane: "kompass-longctx", maxTokens: 8192, signal },
  )

  const lines: ParsedLine[] = []
  let rejected = 0

  for (const row of answer.transactions) {
    const bookedOn = parseDate(row.date)
    const amountCents = parseAmountToCents(row.amount)
    if (!bookedOn || amountCents === null) {
      rejected++
      continue
    }
    const valueDate = row.valueDate ? parseDate(row.valueDate) : null
    lines.push({
      bookedOn,
      spentOn: valueDate ?? bookedOn,
      description: row.description.trim() || row.counterparty?.trim() || "(no description)",
      counterparty: row.counterparty?.trim() || null,
      amountCents,
    })
  }

  return { lines, rejected }
}
