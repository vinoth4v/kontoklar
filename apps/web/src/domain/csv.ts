import { type IsoDate, parseAmountToCents, parseDate } from "@/domain/money"

/**
 * Statement parsing, without a bank connection.
 *
 * Every bank exports a different CSV and none of them agree on a delimiter, a
 * decimal separator, a date order, or whether a debit is a negative number or
 * a separate column. This file handles the mechanics — splitting rows,
 * guessing the delimiter, finding the header — and a set of heuristics maps
 * the columns. What the heuristics cannot map, the model is asked about
 * (see `ai/parse.ts`), and what the model cannot map, the user maps by hand.
 *
 * Three layers, in that order, because the cheap layer is right most of the
 * time and the expensive one should not be paid for a Sparkasse export that
 * looks like every other Sparkasse export.
 */

export type RawRow = Record<string, string>

export type ParsedLine = {
  bookedOn: IsoDate
  spentOn: IsoDate
  description: string
  counterparty: string | null
  amountCents: number
}

export type ColumnMap = {
  date: string
  valueDate?: string
  description: string
  counterparty?: string
  amount?: string
  debit?: string
  credit?: string
}

export type CsvTable = {
  headers: string[]
  rows: RawRow[]
  delimiter: string
  /** Lines before the header — banks love a three-line preamble. */
  skipped: string[]
}

const DELIMITERS = [";", ",", "\t", "|"] as const

/**
 * Split a delimited line, honouring quotes and doubled quotes inside them.
 * Small enough to own; a dependency for this would be silly.
 */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let field = ""
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    // charAt rather than an index: the compiler is right that `line[i]` might
    // be undefined, and charAt is the honest way to say it cannot be here.
    const char = line.charAt(i)
    if (quoted) {
      if (char === '"') {
        if (line.charAt(i + 1) === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      out.push(field.trim())
      field = ""
    } else {
      field += char
    }
  }
  out.push(field.trim())
  return out
}

/** The delimiter that produces the most consistent column count wins. */
export function sniffDelimiter(lines: string[]): string {
  let best = ";"
  let bestScore = -1

  for (const delimiter of DELIMITERS) {
    const counts = lines.slice(0, 20).map((line) => splitLine(line, delimiter).length)
    const max = Math.max(...counts, 0)
    if (max < 2) continue
    const consistent = counts.filter((count) => count === max).length
    const score = max * 10 + consistent
    if (score > bestScore) {
      bestScore = score
      best = delimiter
    }
  }
  return best
}

/**
 * Find the header row and read everything below it.
 *
 * The header is the first line whose fields are mostly non-numeric and which
 * is followed by a line with the same field count — a preamble line rarely
 * satisfies both.
 */
export function parseCsv(text: string): CsvTable {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== "")

  if (lines.length === 0) return { headers: [], rows: [], delimiter: ";", skipped: [] }

  const delimiter = sniffDelimiter(lines)
  let headerAt = 0

  for (let i = 0; i < Math.min(lines.length - 1, 15); i++) {
    const line = lines[i]
    const nextLine = lines[i + 1]
    if (line === undefined || nextLine === undefined) break

    const fields = splitLine(line, delimiter)
    const next = splitLine(nextLine, delimiter)
    const wordy = fields.filter((f) => f !== "" && !/^[\d.,\-+ ]+$/.test(f)).length
    if (fields.length >= 2 && fields.length === next.length && wordy >= fields.length - 1) {
      headerAt = i
      break
    }
  }

  const headers = dedupeHeaders(splitLine(lines[headerAt] ?? "", delimiter))
  const rows: RawRow[] = []

  for (const line of lines.slice(headerAt + 1)) {
    const fields = splitLine(line, delimiter)
    if (fields.every((field) => field === "")) continue
    const row: RawRow = {}
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? ""
    })
    rows.push(row)
  }

  return { headers, rows, delimiter, skipped: lines.slice(0, headerAt) }
}

function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((header, index) => {
    const base = header === "" ? `column_${index + 1}` : header
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}

const HINTS = {
  // Booking date first, value date second — a German statement has both, and
  // reading them the wrong way round shifts every transaction by a day or two
  // in a way nobody notices until a month boundary.
  date: [
    "buchungstag",
    "booking date",
    "posting date",
    "transaction date",
    "belegdatum",
    "datum",
    "date",
  ],
  valueDate: ["valutadatum", "valuta", "wertstellung", "value date", "settlement date"],
  description: [
    "verwendungszweck",
    "description",
    "purpose",
    "reference",
    "details",
    "buchungstext",
    "text",
    "memo",
    "narrative",
  ],
  counterparty: [
    "empfänger",
    "empfaenger",
    "auftraggeber",
    "beguenstigter",
    "begünstigter",
    "payee",
    "counterparty",
    "name",
    "merchant",
    "zahlungspflichtiger",
    "beneficiary",
  ],
  amount: ["betrag", "amount", "umsatz", "value", "summe"],
  debit: ["soll", "debit", "belastung", "withdrawal", "ausgang"],
  credit: ["haben", "credit", "gutschrift", "deposit", "eingang"],
} as const

const norm = (value: string) => value.toLowerCase().replace(/[^a-zß0-9äöü ]/g, " ").trim()

/**
 * Guess which column is which from the header names.
 *
 * Returns null when the two things a transaction cannot exist without — a date
 * and an amount — are not both found. Callers escalate to the model rather
 * than importing something half-understood.
 */
export function guessColumns(headers: string[]): ColumnMap | null {
  const match = (keys: readonly string[]): string | undefined =>
    headers.find((header) => {
      const value = norm(header)
      return keys.some((key) => value === key || value.includes(key))
    })

  const valueDate = match(HINTS.valueDate)
  const date = match(HINTS.date) ?? valueDate
  const description = match(HINTS.description)
  const counterparty = match(HINTS.counterparty)
  const amount = match(HINTS.amount)
  const debit = match(HINTS.debit)
  const credit = match(HINTS.credit)

  if (!date) return null
  if (!amount && !(debit && credit)) return null

  return {
    date,
    valueDate: valueDate && valueDate !== date ? valueDate : undefined,
    description: description ?? counterparty ?? date,
    counterparty,
    amount,
    debit,
    credit,
  }
}

/**
 * Apply a column map to the rows.
 *
 * Rows that do not yield a date and an amount are dropped and counted, never
 * imported as a zero — a silent zero is the kind of error that surfaces three
 * months later as "the numbers are wrong" with no way back to the cause.
 */
export function applyColumnMap(
  rows: readonly RawRow[],
  map: ColumnMap,
): { lines: ParsedLine[]; rejected: number } {
  const lines: ParsedLine[] = []
  let rejected = 0

  for (const row of rows) {
    const bookedOn = parseDate(row[map.date] ?? "")
    if (!bookedOn) {
      rejected++
      continue
    }

    let amountCents: number | null = null
    if (map.amount) {
      amountCents = parseAmountToCents(row[map.amount] ?? "")
    } else if (map.debit && map.credit) {
      const debit = parseAmountToCents(row[map.debit] ?? "")
      const credit = parseAmountToCents(row[map.credit] ?? "")
      // Split columns are written unsigned; the column carries the sign.
      if (debit !== null && debit !== 0) amountCents = -Math.abs(debit)
      else if (credit !== null && credit !== 0) amountCents = Math.abs(credit)
    }

    if (amountCents === null) {
      rejected++
      continue
    }

    const valueDate = map.valueDate ? parseDate(row[map.valueDate] ?? "") : null
    const counterparty = map.counterparty ? (row[map.counterparty] ?? "").trim() : ""
    const description = (row[map.description] ?? "").trim()

    lines.push({
      bookedOn,
      // A statement's value date is the closest thing a CSV has to "when it
      // was actually spent"; card charges get corrected properly during
      // reconciliation, which knows about the card.
      spentOn: valueDate ?? bookedOn,
      description: description || counterparty || "(no description)",
      counterparty: counterparty || null,
      amountCents,
    })
  }

  return { lines, rejected }
}

/**
 * The stable identity of an imported line.
 *
 * Account, both dates, amount, description — and which occurrence within its
 * own file it is. The occurrence index is what makes two identical €3.20
 * coffees on the same day both survive while re-importing the whole statement
 * still collapses onto the same rows: the first file's second coffee and the
 * second file's second coffee produce the same key, and a genuinely new line
 * never does.
 */
export function fingerprint(accountId: string, line: ParsedLine, occurrence = 0): string {
  const parts = [
    accountId,
    line.bookedOn,
    line.spentOn,
    String(line.amountCents),
    line.description.toLowerCase().replace(/\s+/g, " ").slice(0, 120),
    String(occurrence),
  ]
  return parts.join("|")
}

/** Fingerprints for a whole file, numbering repeats as it goes. */
export function fingerprintAll(accountId: string, lines: readonly ParsedLine[]): string[] {
  const seen = new Map<string, number>()
  return lines.map((line) => {
    const base = fingerprint(accountId, line)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return fingerprint(accountId, line, count)
  })
}
