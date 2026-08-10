"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createCategory, createGroup, setPlanned } from "@/data/setup"
import { loadBudget } from "@/data/store"
import { db } from "@/db/client"
import { category, CATEGORY_KINDS } from "@/db/schema"
import { recordEvent } from "@/db/events"
import { addMonths, type Month, parseAmountToCents } from "@/domain/money"

const monthField = z.string().regex(/^\d{4}-\d{2}$/)

/**
 * One save for the whole grid.
 *
 * A budget is edited in passes — you change four numbers, then look at the
 * total — so a per-row save would mean four page loads and four chances to
 * lose the other three.
 */
export async function savePlanAction(form: FormData): Promise<void> {
  const month = monthField.safeParse(form.get("month"))
  if (!month.success) return

  let changed = 0

  for (const [key, value] of form.entries()) {
    if (!key.startsWith("planned-")) continue
    const categoryId = key.slice("planned-".length)
    const cents = parseAmountToCents(String(value))
    // A blank field means "no plan", which is a real answer and different from
    // planning zero — but both store as zero, and the variance table drops
    // lines that have neither plan nor movement, so neither one shouts.
    await setPlanned(categoryId, month.data, cents === null ? 0 : Math.abs(cents))
    changed++
  }

  await recordEvent("budget_changed", null, `${changed} lines for ${month.data}`)
  revalidatePath("/budget")
  revalidatePath("/")
}

export async function createCategoryAction(form: FormData): Promise<void> {
  const parsed = z
    .object({
      name: z.string().min(1).max(60),
      kind: z.enum(CATEGORY_KINDS),
      groupId: z.string().optional(),
      fixedCost: z.string().optional(),
      visibility: z.enum(["shared", "private"]).optional(),
      planned: z.string().optional(),
      month: monthField,
    })
    .safeParse({
      name: form.get("name"),
      kind: form.get("kind"),
      groupId: form.get("groupId") ?? "",
      fixedCost: form.get("fixedCost") ?? "",
      visibility: form.get("visibility") ?? "shared",
      planned: form.get("planned") ?? "",
      month: form.get("month"),
    })

  if (!parsed.success) return

  const id = await createCategory({
    name: parsed.data.name,
    kind: parsed.data.kind,
    groupId: parsed.data.groupId || null,
    fixedCost: parsed.data.fixedCost === "on",
    visibility: parsed.data.visibility ?? "shared",
  })

  const planned = parseAmountToCents(parsed.data.planned ?? "")
  if (planned !== null && planned !== 0) {
    await setPlanned(id, parsed.data.month, Math.abs(planned))
  }

  await recordEvent("budget_changed", null, `category ${parsed.data.name} created`)
  revalidatePath("/budget")
  revalidatePath("/")
}

export async function createGroupAction(form: FormData): Promise<void> {
  const name = String(form.get("name") ?? "").trim()
  if (name === "") return
  await createGroup(name.slice(0, 60))
  revalidatePath("/budget")
}

/** Archive, never delete: a deleted category takes its history's meaning with
 * it, and every past month silently re-reads as unexplained. */
export async function archiveCategoryAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "")
  if (!id) return

  const rows = await db().select().from(category).where(eq(category.id, id)).limit(1)
  const current = rows[0]
  if (!current) return

  await db()
    .update(category)
    .set({ archivedAt: current.archivedAt ? null : new Date() })
    .where(eq(category.id, id))

  await recordEvent("budget_changed", null, `${current.archivedAt ? "restored" : "archived"} ${current.name}`)
  revalidatePath("/budget")
  revalidatePath("/")
}

/** Most months are last month with two numbers changed. */
export async function copyPreviousMonthAction(form: FormData): Promise<void> {
  const month = monthField.safeParse(form.get("month"))
  if (!month.success) return

  const previous: Month = addMonths(month.data, -1)
  const plan = await loadBudget(previous)

  for (const [categoryId, plannedCents] of plan) {
    await setPlanned(categoryId, month.data, plannedCents)
  }

  await recordEvent("budget_changed", null, `copied ${previous} into ${month.data}`)
  revalidatePath("/budget")
  revalidatePath("/")
}
