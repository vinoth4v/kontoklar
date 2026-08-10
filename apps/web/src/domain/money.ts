/**
 * Money handling, and the two formats the world writes numbers in.
 *
 * Everything inside the app is signed integer cents. Parsing happens once, at
 * the edge, when a statement or a form arrives; formatting happens once, in a
 * component. Nothing in between ever sees a float.
 */

/** `YYYY-MM`. Months are strings because that is what sorts, groups and joins. */
export type Month = string

/** `YYYY-MM-DD`, matching Postgres `date`, which Drizzle also hands back as a string. */
export type IsoDate = string

const AMOUNT_CHARS = /[^\d,.\-+]/g

/**
 * Parse an amount written by a human or a bank.
 *
 * The hard case is that `1.234,56` and `1,234.56` are the same number written
 * by different countries, and `1.234` is ambiguous on its own. The rule used
 * here: whichever separator appears *last* is the decimal one, and if only one
 * separator appears with exactly three digits after it, it is a thousands
 * separator. That resolves every real statement seen so far and fails loudly
 * rather than silently on the rest.
 *
 * Trailing `-` (German bank CSVs) and parenthesised negatives (Anglo exports)
 * both mean the same thing.
 */
export function parseAmountToCents(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null

  const parenthesised = /^\((.*)\)$/.exec(trimmed)
  const inner = parenthesised?.[1] ?? trimmed

  let negative = Boolean(parenthesised)
  let body = inner.replace(AMOUNT_CHARS, "")

  if (body.endsWith("-")) {
    negative = true
    body = body.slice(0, -1)
  }
  if (body.startsWith("-")) {
    negative = true
    body = body.slice(1)
  }
  if (body.startsWith("+")) body = body.slice(1)

  if (body === "" || /[-+]/.test(body)) return null

  const lastComma = body.lastIndexOf(",")
  const lastDot = body.lastIndexOf(".")
  let decimalAt = -1

  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot)
  } else if (lastComma >= 0 || lastDot >= 0) {
    const only = Math.max(lastComma, lastDot)
    const after = body.length - only - 1
    // Three digits after a lone separator is a thousands group ("1.234"),
    // anything else is a decimal point.
    decimalAt = after === 3 ? -1 : only
  }

  const digitsOnly = (s: string) => s.replace(/[^\d]/g, "")
  const whole = decimalAt >= 0 ? digitsOnly(body.slice(0, decimalAt)) : digitsOnly(body)
  const fraction = decimalAt >= 0 ? digitsOnly(body.slice(decimalAt + 1)) : ""

  if (whole === "" && fraction === "") return null

  const centsPart = fraction === "" ? 0 : Number(`${fraction}00`.slice(0, 2))
  const cents = Number(whole || "0") * 100 + centsPart
  if (!Number.isFinite(cents)) return null

  return negative ? -cents : cents
}

/** The inverse, for round-tripping into a form field. Always `-12.34` style. */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
}

/**
 * Format for display, in the user's locale and currency.
 *
 * `Intl` is in the platform, so localisation costs a dependency of zero. A bad
 * locale or currency code throws inside `Intl`, and a formatting error must
 * never take a page down, so it falls back to something readable.
 */
export function formatMoney(cents: number, currency = "EUR", locale = "de-DE"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100)
  } catch {
    return `${centsToInput(cents)} ${currency}`
  }
}

/** Same, rounded to whole units — headline numbers do not need the cents. */
export function formatMoneyShort(cents: number, currency = "EUR", locale = "de-DE"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100)
  } catch {
    return `${Math.round(cents / 100)} ${currency}`
  }
}

/**
 * Parse a date written in any of the orders statements use.
 *
 * ISO is tried first because it is unambiguous. `31.12.2025` and `31/12/2025`
 * are day-first; `12/31/2025` is month-first and is detected by the day being
 * impossible as a month. `01/02/2025` is genuinely ambiguous, and day-first
 * wins because every European statement format is day-first and the US ones
 * that are not tend to export ISO.
 */
export function parseDate(raw: string): IsoDate | null {
  const value = raw.trim()
  if (value === "") return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (iso) return assemble(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const parts = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(value)
  if (!parts) return null

  let first = Number(parts[1])
  let second = Number(parts[2])
  const yearRaw = Number(parts[3])
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw

  if (first > 12 && second <= 12) {
    // day-first, unambiguously
  } else if (second > 12 && first <= 12) {
    ;[first, second] = [second, first]
  }

  return assemble(year, second, first)
}

function assemble(year: number, month: number, day: number): IsoDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const stamp = new Date(Date.UTC(year, month - 1, day))
  if (stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) return null
  return stamp.toISOString().slice(0, 10)
}

export function monthOf(date: IsoDate): Month {
  return date.slice(0, 7)
}

export function addMonths(month: Month, delta: number): Month {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`
}

/** Newest first, which is the order every screen wants. */
export function recentMonths(latest: Month, count: number): Month[] {
  return Array.from({ length: count }, (_, i) => addMonths(latest, -i))
}

export function formatMonth(month: Month, locale = "de-DE"): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)),
    )
  } catch {
    return month
  }
}

export function formatDate(date: IsoDate, locale = "de-DE"): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(`${date}T00:00:00Z`),
    )
  } catch {
    return date
  }
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  const left = Date.parse(`${a}T00:00:00Z`)
  const right = Date.parse(`${b}T00:00:00Z`)
  return Math.round(Math.abs(left - right) / 86_400_000)
}
