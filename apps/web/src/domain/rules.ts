/**
 * Categorisation that gets better because you corrected it.
 *
 * A rule is a normalised fragment of a counterparty or description mapped to a
 * category. Rules run before the model is ever asked: they are free, instant,
 * and — because every one of them came from the user — right by definition.
 * The model only sees what no rule explains, which makes a second import of
 * the same shop cost nothing at all.
 */

export type Rule = { matcher: string; categoryId: string }

export type Categorisable = {
  description: string
  counterparty: string | null
}

/**
 * Strip the noise banks put in a payment reference: card scheme boilerplate,
 * transaction ids, dates, IBANs, long digit runs. What survives is the part a
 * human would call "who this was".
 */
export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[a-z]{2}\d{2}[a-z0-9]{10,30}/g, " ")
    .replace(/\b\d{2}[./-]\d{2}[./-]\d{2,4}\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(
      /\b(kartenzahlung|lastschrift|dauerauftrag|überweisung|ueberweisung|sepa|elv|girocard|visa|mastercard|debitk|nr|ref|end to end|endtoend|mandat|gläubiger|glaeubiger|id|purchase|payment|pos|card|debit|direct debit|transaction)\b/g,
      " ",
    )
    .replace(/[^a-z0-9äöüß ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * The fragment a new rule should key on: the first few meaningful words of the
 * counterparty, falling back to the description. Short enough to generalise
 * across "REWE SAGT DANKE 4711" and "REWE MARKT GMBH", long enough not to
 * catch everything.
 */
export function matcherFor(txn: Categorisable): string | null {
  const source = normalise(txn.counterparty ?? "") || normalise(txn.description)
  const words = source.split(" ").filter((word) => word.length > 2)
  if (words.length === 0) return null
  return words.slice(0, 3).join(" ")
}

/**
 * Apply rules, longest matcher first.
 *
 * Longest-first matters: "amazon prime" must beat "amazon", or a subscription
 * silently lands in shopping and the user corrects the same thing forever.
 */
export function matchRule<R extends Rule>(txn: Categorisable, rules: readonly R[]): R | null {
  const haystack = `${normalise(txn.counterparty ?? "")} ${normalise(txn.description)}`.trim()
  if (haystack === "") return null

  const ordered = [...rules].sort((a, b) => b.matcher.length - a.matcher.length)
  for (const rule of ordered) {
    if (rule.matcher !== "" && haystack.includes(rule.matcher)) return rule
  }
  return null
}

export function applyRules(txn: Categorisable, rules: readonly Rule[]): string | null {
  return matchRule(txn, rules)?.categoryId ?? null
}

/**
 * Group unexplained lines by what they look like, so one model call answers
 * for many transactions instead of one call per row. Fifty coffee purchases at
 * the same shop are one question.
 */
export function groupForCategorisation<T extends Categorisable>(
  txns: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const txn of txns) {
    const key = matcherFor(txn) ?? (normalise(txn.description) || "(blank)")
    const bucket = groups.get(key)
    if (bucket) bucket.push(txn)
    else groups.set(key, [txn])
  }
  return groups
}

/**
 * Detect a recurring charge: the same payee, at a regular interval, for a
 * similar amount. Feeds the annual audit's dead-subscription and
 * duplicate-mandate findings, and does it without a model — a model asked
 * "is this recurring" would be guessing at what arithmetic already knows.
 */
export type RecurringCandidate = {
  matcher: string
  occurrences: number
  averageCents: number
  averageIntervalDays: number
  lastSeen: string
  firstSeen: string
}

export function findRecurring(
  txns: readonly (Categorisable & { spentOn: string; amountCents: number })[],
  minOccurrences = 3,
): RecurringCandidate[] {
  const groups = new Map<string, (typeof txns)[number][]>()
  for (const txn of txns) {
    if (txn.amountCents >= 0) continue
    const key = matcherFor(txn)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(txn)
    else groups.set(key, [txn])
  }

  const out: RecurringCandidate[] = []

  for (const [matcher, bucket] of groups) {
    if (bucket.length < minOccurrences) continue
    const sorted = [...bucket].sort((a, b) => a.spentOn.localeCompare(b.spentOn))

    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    if (!first || !last) continue

    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1]
      const current = sorted[i]
      if (!previous || !current) continue
      gaps.push(
        Math.round(
          (Date.parse(`${current.spentOn}T00:00:00Z`) -
            Date.parse(`${previous.spentOn}T00:00:00Z`)) /
            86_400_000,
        ),
      )
    }
    if (gaps.length === 0) continue

    const averageIntervalDays = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
    // Irregular gaps mean a shop you visit often, not a subscription.
    const spread = Math.max(...gaps) - Math.min(...gaps)
    if (averageIntervalDays < 20 || averageIntervalDays > 400) continue
    if (spread > averageIntervalDays * 0.8) continue

    out.push({
      matcher,
      occurrences: sorted.length,
      averageCents: Math.round(
        sorted.reduce((sum, txn) => sum + txn.amountCents, 0) / sorted.length,
      ),
      averageIntervalDays: Math.round(averageIntervalDays),
      firstSeen: first.spentOn,
      lastSeen: last.spentOn,
    })
  }

  return out.sort((a, b) => a.averageCents - b.averageCents)
}
