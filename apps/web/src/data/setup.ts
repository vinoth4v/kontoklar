import { eq } from "drizzle-orm"
import type { BudgetDraft } from "@/ai/budget"
import { db } from "@/db/client"
import { account, budgetLine, category, categoryGroup } from "@/db/schema"
import type { AccountKind, CategoryKind } from "@/db/schema"
import type { Month } from "@/domain/money"

/**
 * Creating the things the user configures: accounts, groups, categories,
 * planned amounts.
 *
 * Nothing here is seeded on install. An app that ships "Groceries, Transport,
 * Entertainment" has already decided what this person's life looks like, and
 * the first thing they do is delete half of it. Categories arrive either from
 * a draft the user accepted or from the user typing one.
 */

export type AccountInput = {
  name: string
  kind: AccountKind
  institution?: string | null
  owner?: string | null
  currency: string
  openingBalanceCents: number
  settlementAccountId?: string | null
}

export async function createAccount(input: AccountInput): Promise<string> {
  const rows = await db()
    .insert(account)
    .values({
      name: input.name,
      kind: input.kind,
      institution: input.institution ?? null,
      owner: input.owner ?? null,
      currency: input.currency,
      openingBalanceCents: input.openingBalanceCents,
      settlementAccountId: input.settlementAccountId ?? null,
    })
    .returning({ id: account.id })

  return required(rows[0], "account")
}

/** An insert that returned nothing is a failure worth naming, not a crash
 * three frames later on an undefined id. */
function required(row: { id: string } | undefined, what: string): string {
  if (!row) throw new Error(`Creating the ${what} returned no row.`)
  return row.id
}

export async function updateAccount(id: string, input: Partial<AccountInput>): Promise<void> {
  await db()
    .update(account)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.institution === undefined ? {} : { institution: input.institution }),
      ...(input.owner === undefined ? {} : { owner: input.owner }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.openingBalanceCents === undefined
        ? {}
        : { openingBalanceCents: input.openingBalanceCents }),
      ...(input.settlementAccountId === undefined
        ? {}
        : { settlementAccountId: input.settlementAccountId }),
    })
    .where(eq(account.id, id))
}

export async function createGroup(name: string, sortOrder = 0): Promise<string> {
  const rows = await db()
    .insert(categoryGroup)
    .values({ name, sortOrder })
    .returning({ id: categoryGroup.id })
  return required(rows[0], "group")
}

export type CategoryInput = {
  name: string
  kind: CategoryKind
  groupId?: string | null
  fixedCost?: boolean
  visibility?: "shared" | "private"
}

export async function createCategory(input: CategoryInput): Promise<string> {
  const rows = await db()
    .insert(category)
    .values({
      name: input.name,
      kind: input.kind,
      groupId: input.groupId ?? null,
      fixedCost: input.fixedCost ?? false,
      visibility: input.visibility ?? "shared",
    })
    .returning({ id: category.id })
  return required(rows[0], "category")
}

export async function setPlanned(
  categoryId: string,
  month: Month,
  plannedCents: number,
): Promise<void> {
  await db()
    .insert(budgetLine)
    .values({ categoryId, month, plannedCents })
    .onConflictDoUpdate({
      target: [budgetLine.categoryId, budgetLine.month],
      set: { plannedCents },
    })
}

/**
 * Turn an accepted draft into real rows.
 *
 * Written as plain inserts rather than a bulk statement because the numbers
 * involved are small (a dozen categories) and the readability of the failure
 * matters more than the round trips.
 */
export async function applyDraft(draft: BudgetDraft, month: Month): Promise<number> {
  let created = 0

  for (const [index, group] of draft.groups.entries()) {
    const groupId = await createGroup(group.name, index)

    for (const line of group.categories) {
      const categoryId = await createCategory({
        name: line.name,
        kind: line.kind,
        groupId,
        fixedCost: line.fixedCost,
      })
      if (line.plannedCents !== 0) {
        await setPlanned(categoryId, month, Math.abs(Math.round(line.plannedCents)))
      }
      created++
    }
  }

  return created
}
