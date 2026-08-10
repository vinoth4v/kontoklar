import { randomUUID } from "node:crypto"
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { categorise } from "@/ai/categorize"
import { AiUnavailable, aiConfigured } from "@/ai/json"
import { extractFromText, mapColumnsWithAi } from "@/ai/parse"
import { db } from "@/db/client"
import { account, category, categoryGroup, categoryRule, importBatch, txn } from "@/db/schema"
import type { NewTxnRow } from "@/db/schema"
import {
  applyColumnMap,
  fingerprintAll,
  guessColumns,
  type ParsedLine,
  parseCsv,
} from "@/domain/csv"
import { extractPdfText } from "@/domain/pdf"
import {
  detectTransfers,
  type ReconcilableAccount,
  type ReconcilableTxn,
  reconcileSettlements,
} from "@/domain/reconcile"
import { applyRules, matchRule, matcherFor } from "@/domain/rules"

/**
 * Import, reconcile, categorise — the path a statement takes from a file to a
 * number on the dashboard.
 *
 * Ordering is not incidental. Duplicates are rejected before anything is
 * written, transfers and settlements are resolved before categorisation so the
 * model is never asked to categorise a transfer, and the user's own rules run
 * before the model so a correction made once is never paid for again.
 *
 * Every step degrades rather than fails: no model configured means rules-only
 * categorisation, and everything the pipeline could not explain is left
 * visible as unexplained rather than guessed at.
 */

export type ImportOutcome = {
  batchId: string
  parser: "csv" | "csv+ai" | "pdf+ai"
  parsed: number
  imported: number
  duplicates: number
  rejected: number
  categorised: number
  transfers: number
  unexplainedCents: number
  warnings: string[]
}

export async function importStatement(
  accountId: string,
  filename: string,
  bytes: Uint8Array,
  options: { useAi?: boolean } = {},
): Promise<ImportOutcome> {
  const useAi = (options.useAi ?? true) && aiConfigured()
  const warnings: string[] = []

  const isPdf = filename.toLowerCase().endsWith(".pdf") || looksLikePdf(bytes)
  let lines: ParsedLine[] = []
  let rejected = 0
  let parser: ImportOutcome["parser"] = "csv"

  if (isPdf) {
    if (!useAi) {
      throw new ImportProblem(
        "A PDF statement can only be read with the AI parser, and the model gateway is not configured. Export CSV from your bank instead.",
      )
    }
    const text = extractPdfText(bytes)
    if (text.length < 80) {
      throw new ImportProblem(
        "No text could be read from that PDF — it is probably a scan. Export CSV from your bank instead.",
      )
    }
    parser = "pdf+ai"
    const extracted = await extractFromText(text)
    lines = extracted.lines
    rejected = extracted.rejected
  } else {
    const table = parseCsv(new TextDecoder("utf-8").decode(bytes))
    if (table.rows.length === 0) throw new ImportProblem("No rows were found in that file.")

    let map = guessColumns(table.headers)
    if (!map) {
      if (!useAi) {
        throw new ImportProblem(
          `The columns in that file could not be recognised (${table.headers.join(", ")}), and the model gateway is not configured to ask about them.`,
        )
      }
      parser = "csv+ai"
      map = await mapColumnsWithAi(table)
      if (!map) throw new ImportProblem("Even the model could not tell which column is which.")
    }

    const applied = applyColumnMap(table.rows, map)
    lines = applied.lines
    rejected = applied.rejected
  }

  if (rejected > 0) {
    warnings.push(`${rejected} row${rejected === 1 ? "" : "s"} had no readable date or amount and were skipped.`)
  }
  if (lines.length === 0) throw new ImportProblem("Nothing importable was found in that file.")

  const refs = fingerprintAll(accountId, lines)
  const existing = await db()
    .select({ externalRef: txn.externalRef })
    .from(txn)
    .where(inArray(txn.externalRef, refs))
  const known = new Set(
    existing.map((row) => row.externalRef).filter((ref): ref is string => ref !== null),
  )

  const batchId = randomUUID()
  const fresh: NewTxnRow[] = []

  lines.forEach((line, index) => {
    const ref = refs[index]
    if (ref === undefined || known.has(ref)) return
    fresh.push({
      accountId,
      bookedOn: line.bookedOn,
      spentOn: line.spentOn,
      description: line.description.slice(0, 500),
      counterparty: line.counterparty?.slice(0, 200) ?? null,
      amountCents: line.amountCents,
      role: "spending",
      source: "import",
      importId: batchId,
      externalRef: ref,
    })
  })

  // Chunked because a year of statements is a few thousand rows and one
  // statement of that size is a query too large for the HTTP driver.
  for (let i = 0; i < fresh.length; i += 200) {
    await db().insert(txn).values(fresh.slice(i, i + 200)).onConflictDoNothing()
  }

  await db().insert(importBatch).values({
    id: batchId,
    accountId,
    filename: filename.slice(0, 200),
    parsedRows: lines.length,
    importedRows: fresh.length,
    duplicateRows: lines.length - fresh.length,
    parser,
    note: warnings.join(" ") || null,
  })

  const reconciliation = await runReconciliation()
  const categorisation = await runCategorisation({ useAi })
  if (categorisation.error) warnings.push(categorisation.error)

  return {
    batchId,
    parser,
    parsed: lines.length,
    imported: fresh.length,
    duplicates: lines.length - fresh.length,
    rejected,
    categorised: categorisation.categorised,
    transfers: reconciliation.transfers,
    unexplainedCents: reconciliation.unexplainedCents,
    warnings,
  }
}

export class ImportProblem extends Error {}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

export type ReconciliationOutcome = {
  transfers: number
  settlements: number
  unexplainedCents: number
}

/**
 * Re-derive transfers and card settlements over everything.
 *
 * Idempotent by construction: it only ever looks at lines that are not already
 * paired and not confirmed by the user, and the unexplained remainders it
 * creates carry a deterministic `externalRef` so running it twice produces the
 * same rows rather than a second copy of them.
 */
export async function runReconciliation(): Promise<ReconciliationOutcome> {
  const accounts = await db().select().from(account)
  const rows = await db().select().from(txn)

  const shapes: ReconcilableAccount[] = accounts.map((a) => ({
    id: a.id,
    kind: a.kind,
    settlementAccountId: a.settlementAccountId,
  }))

  const candidates: ReconcilableTxn[] = rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    bookedOn: row.bookedOn,
    spentOn: row.spentOn,
    amountCents: row.amountCents,
    description: row.description,
    role: row.role,
    transferGroup: row.transferGroup,
    confirmedByUser: row.confirmedByUser,
  }))

  const pairs = detectTransfers(candidates, shapes)
  const cardById = new Map(accounts.filter((a) => a.kind === "credit_card").map((a) => [a.id, a]))
  const byId = new Map(candidates.map((row) => [row.id, row]))

  for (const pair of pairs) {
    const group = randomUUID()
    const from = byId.get(pair.fromId)
    const to = byId.get(pair.toId)
    const cardSide = [from, to].find((side) => side && cardById.has(side.accountId))

    for (const id of [pair.fromId, pair.toId]) {
      await db()
        .update(txn)
        .set({
          role: pair.role,
          transferGroup: group,
          // A transfer has no category by definition; clearing one that a
          // previous pass guessed at is part of the correction.
          categoryId: null,
          settlesAccountId: pair.role === "settlement" ? (cardSide?.accountId ?? null) : null,
        })
        .where(eq(txn.id, id))
    }
  }

  // Settlements, including ones the user marked by hand on an account whose
  // card statement was never imported.
  const settlements = await db()
    .select()
    .from(txn)
    .where(and(eq(txn.role, "settlement"), isNotNull(txn.settlesAccountId)))

  let unexplainedCents = 0
  let settlementCount = 0

  for (const cardId of new Set(settlements.map((row) => row.settlesAccountId))) {
    if (!cardId) continue
    // Only the paying side: the credit that lands on the card itself is the
    // same money seen from the other end.
    const payments = settlements
      .filter((row) => row.settlesAccountId === cardId && row.amountCents < 0)
      .map(toReconcilable)

    const charges = (await db().select().from(txn).where(eq(txn.accountId, cardId)))
      .filter((row) => row.source !== "reconciliation")
      .map(toReconcilable)

    const results = reconcileSettlements(payments, charges, cardId)
    settlementCount += results.length

    for (const result of results) {
      const ref = `recon:${result.paymentId}`
      const payment = payments.find((p) => p.id === result.paymentId)
      if (!payment) continue

      if (result.remainderCents <= 0) {
        await db().delete(txn).where(eq(txn.externalRef, ref))
        continue
      }

      unexplainedCents += result.remainderCents

      await db()
        .insert(txn)
        .values({
          accountId: cardId,
          bookedOn: payment.bookedOn,
          spentOn: payment.spentOn,
          description: `Unexplained card spending settled on ${payment.bookedOn}`,
          amountCents: -result.remainderCents,
          role: "spending",
          source: "reconciliation",
          externalRef: ref,
          aiReason:
            "The card payment was larger than the charges imported for this card. The difference is real spending whose detail is missing — import the card statement to replace this line.",
        })
        .onConflictDoUpdate({
          target: txn.externalRef,
          set: { amountCents: -result.remainderCents, spentOn: payment.spentOn },
        })
    }
  }

  return { transfers: pairs.length, settlements: settlementCount, unexplainedCents }
}

function toReconcilable(row: typeof txn.$inferSelect): ReconcilableTxn {
  return {
    id: row.id,
    accountId: row.accountId,
    bookedOn: row.bookedOn,
    spentOn: row.spentOn,
    amountCents: row.amountCents,
    description: row.description,
    role: row.role,
    transferGroup: row.transferGroup,
    confirmedByUser: row.confirmedByUser,
  }
}

export type CategorisationOutcome = {
  categorised: number
  byRule: number
  byModel: number
  error?: string
}

/**
 * Categorise what has no category yet: rules first, then the model.
 *
 * The model is never asked about a transfer or a settlement, never asked about
 * something a rule already answers, and never trusted to invent a category id.
 * What it declines to answer stays unexplained, which is a visible state with
 * a button next to it rather than a silent one.
 */
export async function runCategorisation(
  options: { useAi?: boolean } = {},
): Promise<CategorisationOutcome> {
  const useAi = (options.useAi ?? true) && aiConfigured()

  const pending = await db()
    .select()
    .from(txn)
    .where(and(isNull(txn.categoryId), eq(txn.role, "spending"), eq(txn.confirmedByUser, false)))

  if (pending.length === 0) return { categorised: 0, byRule: 0, byModel: 0 }

  const rules = await db().select().from(categoryRule)
  const categories = await db()
    .select({
      id: category.id,
      name: category.name,
      kind: category.kind,
      group: categoryGroup.name,
    })
    .from(category)
    .leftJoin(categoryGroup, eq(category.groupId, categoryGroup.id))
    .where(isNull(category.archivedAt))

  let byRule = 0
  const remaining: typeof pending = []

  for (const row of pending) {
    const rule = matchRule(row, rules)
    if (rule) {
      await db()
        .update(txn)
        .set({ categoryId: rule.categoryId, aiReason: "Matched a rule you taught it.", aiConfidence: 100 })
        .where(eq(txn.id, row.id))
      await db()
        .update(categoryRule)
        .set({ hits: sql`${categoryRule.hits} + 1` })
        .where(eq(categoryRule.id, rule.id))
      byRule++
    } else {
      remaining.push(row)
    }
  }

  if (remaining.length === 0 || !useAi || categories.length === 0) {
    return {
      categorised: byRule,
      byRule,
      byModel: 0,
      error:
        remaining.length > 0 && !useAi
          ? `${remaining.length} transactions are uncategorised and the model gateway is not configured, so they are waiting for you.`
          : undefined,
    }
  }

  let byModel = 0

  try {
    // Capped: an import of several years should not turn into one enormous
    // prompt. The rest are picked up by the next run, and are visible as
    // unexplained until then.
    const decisions = await categorise(remaining.slice(0, 300), categories)
    for (const decision of decisions) {
      if (!decision.categoryId) continue
      await db()
        .update(txn)
        .set({
          categoryId: decision.categoryId,
          aiConfidence: decision.confidence,
          aiReason: decision.reason,
        })
        .where(inArray(txn.id, decision.txnIds))
      byModel += decision.txnIds.length
      if (decision.fixedCost) {
        await db()
          .update(category)
          .set({ fixedCost: true })
          .where(eq(category.id, decision.categoryId))
      }
    }
  } catch (error) {
    return {
      categorised: byRule,
      byRule,
      byModel: 0,
      error:
        error instanceof AiUnavailable
          ? `Automatic categorisation is unavailable right now (${error.message}). Everything imported fine and is waiting to be categorised.`
          : `Automatic categorisation failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { categorised: byRule + byModel, byRule, byModel }
}

/**
 * Record a correction as a rule, then apply it everywhere it fits.
 *
 * "Have it remembered" means exactly this: the same payee never has to be
 * corrected twice, including on transactions already imported.
 */
export async function teachCategory(txnId: string, categoryId: string | null): Promise<number> {
  const rows = await db().select().from(txn).where(eq(txn.id, txnId)).limit(1)
  const row = rows[0]
  if (!row) return 0

  await db()
    .update(txn)
    .set({
      categoryId,
      confirmedByUser: true,
      aiReason: "You set this.",
      aiConfidence: 100,
    })
    .where(eq(txn.id, txnId))

  if (!categoryId) return 1

  const matcher = matcherFor(row)
  if (!matcher) return 1

  await db()
    .insert(categoryRule)
    .values({ matcher, categoryId, hits: 1 })
    .onConflictDoUpdate({ target: categoryRule.matcher, set: { categoryId } })

  // Apply the freshly learned rule to everything it now explains, except
  // anything the user has already decided about themselves.
  const candidates = await db()
    .select()
    .from(txn)
    .where(and(eq(txn.confirmedByUser, false), eq(txn.role, "spending")))

  let applied = 1
  for (const candidate of candidates) {
    if (candidate.categoryId === categoryId) continue
    if (applyRules(candidate, [{ matcher, categoryId }]) !== categoryId) continue
    await db()
      .update(txn)
      .set({ categoryId, aiReason: "Matched a rule you taught it.", aiConfidence: 100 })
      .where(eq(txn.id, candidate.id))
    applied++
  }

  return applied
}
