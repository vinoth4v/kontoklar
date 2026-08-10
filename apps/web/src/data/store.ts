import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm"
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
import type { AiNoteKind } from "@/db/schema"
import { DEFAULT_SETTINGS, type Settings } from "@/domain/locale"
import { addMonths, type Month, monthOf } from "@/domain/money"

/**
 * Every read the app does, in one file.
 *
 * Pages call these; the domain modules do the arithmetic on what comes back.
 * Keeping the queries here rather than in components is what makes the whole
 * of `domain/` testable without a database — which is where the logic worth
 * testing lives.
 */

export type Workspace = {
  accounts: (typeof account.$inferSelect)[]
  groups: (typeof categoryGroup.$inferSelect)[]
  categories: (typeof category.$inferSelect)[]
  settings: Settings
}

export async function loadWorkspace(): Promise<Workspace> {
  const [accounts, groups, categories, settings] = await Promise.all([
    db().select().from(account).orderBy(asc(account.createdAt)),
    db().select().from(categoryGroup).orderBy(asc(categoryGroup.sortOrder), asc(categoryGroup.name)),
    db().select().from(category).orderBy(asc(category.name)),
    loadSettings(),
  ])

  return { accounts, groups, categories, settings }
}

export async function loadSettings(): Promise<Settings> {
  const rows = await db().select().from(appSetting)
  const map = new Map(rows.map((row) => [row.key, row.value]))

  return {
    country: map.get("country") ?? DEFAULT_SETTINGS.country,
    currency: map.get("currency") ?? DEFAULT_SETTINGS.currency,
    locale: map.get("locale") ?? DEFAULT_SETTINGS.locale,
    householdName: map.get("householdName") ?? DEFAULT_SETTINGS.householdName,
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const entries = Object.entries(settings)
  for (const [key, value] of entries) {
    await db()
      .insert(appSetting)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } })
  }
}

/** Transactions from a month onward. Analytics never need the whole history. */
export async function loadTxns(fromMonth?: Month) {
  const query = db().select().from(txn)
  const rows = fromMonth
    ? await query.where(gte(txn.spentOn, `${fromMonth}-01`)).orderBy(desc(txn.spentOn))
    : await query.orderBy(desc(txn.spentOn))
  return rows
}

/** Everything, for balances — a balance is wrong if it starts part-way through. */
export async function loadAllTxns() {
  return db().select().from(txn).orderBy(desc(txn.spentOn))
}

export async function loadBudget(month: Month): Promise<Map<string, number>> {
  const rows = await db().select().from(budgetLine).where(eq(budgetLine.month, month))
  return new Map(rows.map((row) => [row.categoryId, row.plannedCents]))
}

export async function loadRules() {
  return db().select().from(categoryRule).orderBy(desc(categoryRule.hits))
}

export async function loadImports() {
  return db().select().from(importBatch).orderBy(desc(importBatch.createdAt)).limit(20)
}

export async function loadNotes(kind: AiNoteKind, limit = 10) {
  return db()
    .select()
    .from(aiNote)
    .where(eq(aiNote.kind, kind))
    .orderBy(desc(aiNote.createdAt))
    .limit(limit)
}

export async function latestNote(kind: AiNoteKind, subject: string) {
  const rows = await db()
    .select()
    .from(aiNote)
    .where(and(eq(aiNote.kind, kind), eq(aiNote.subject, subject)))
    .orderBy(desc(aiNote.createdAt))
    .limit(1)
  return rows[0]
}

export async function saveNote(
  kind: AiNoteKind,
  subject: string,
  body: string,
  question?: string,
): Promise<void> {
  await db().insert(aiNote).values({ kind, subject, body, question: question ?? null })
}

/**
 * Has anything been set up at all?
 *
 * `/` shows the app when this is true and onboarding when it is not — the
 * decision has to be one cheap query, because it runs on every visit to the
 * home page.
 */
export async function isConfigured(): Promise<boolean> {
  const rows = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(account)
  return (rows[0]?.count ?? 0) > 0
}

export async function countUncategorised(): Promise<number> {
  const rows = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(txn)
    .where(and(isNull(txn.categoryId), eq(txn.role, "spending")))
  return rows[0]?.count ?? 0
}

/** The most recent month with any activity, so a dormant app opens on data
 * rather than on an empty current month. */
export async function latestActiveMonth(fallback: Month): Promise<Month> {
  const rows = await db()
    .select({ spentOn: txn.spentOn })
    .from(txn)
    .orderBy(desc(txn.spentOn))
    .limit(1)
  const latest = rows[0]?.spentOn
  return latest ? monthOf(latest) : fallback
}

export function windowStart(month: Month, months = 12): Month {
  return addMonths(month, -(months - 1))
}
