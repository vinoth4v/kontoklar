"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { runCategorisation, runReconciliation, teachCategory } from "@/data/pipeline"
import { db } from "@/db/client"
import { txn, TXN_ROLES } from "@/db/schema"
import { recordEvent } from "@/db/events"

const update = z.object({
  id: z.uuid(),
  categoryId: z.string(),
  role: z.enum(TXN_ROLES),
  settlesAccountId: z.string(),
})

/**
 * One row, corrected.
 *
 * Three things can be wrong about a transaction and all three are fixed here:
 * its category, whether it is spending at all, and — if it is a card being
 * paid off — which card. A category change teaches a rule; the other two
 * re-run reconciliation, because they change what the whole month means.
 */
export async function updateTxnAction(form: FormData): Promise<void> {
  const parsed = update.safeParse({
    id: form.get("id"),
    categoryId: form.get("categoryId") ?? "",
    role: form.get("role") ?? "spending",
    settlesAccountId: form.get("settlesAccountId") ?? "",
  })
  if (!parsed.success) return

  const rows = await db().select().from(txn).where(eq(txn.id, parsed.data.id)).limit(1)
  const current = rows[0]
  if (!current) return

  const nextCategory = parsed.data.categoryId === "" ? null : parsed.data.categoryId
  const roleChanged =
    current.role !== parsed.data.role ||
    (current.settlesAccountId ?? "") !== parsed.data.settlesAccountId

  if (roleChanged) {
    await db()
      .update(txn)
      .set({
        role: parsed.data.role,
        settlesAccountId: parsed.data.settlesAccountId || null,
        // A transfer or a settlement is not spending, so it cannot hold a
        // spending category.
        categoryId: parsed.data.role === "spending" ? current.categoryId : null,
        transferGroup: parsed.data.role === "spending" ? null : current.transferGroup,
        confirmedByUser: true,
      })
      .where(eq(txn.id, parsed.data.id))
  }

  if (parsed.data.role === "spending" && nextCategory !== current.categoryId) {
    const applied = await teachCategory(parsed.data.id, nextCategory)
    await recordEvent("txn_recategorised", null, `${applied} transactions matched the new rule`)
  }

  if (roleChanged) await runReconciliation()

  revalidatePath("/transactions")
  revalidatePath("/")
}

/** Manual rows can be removed; imported ones cannot, or a re-import would
 * silently bring them back and the ledger would disagree with itself. */
export async function deleteTxnAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "")
  if (!id) return

  const rows = await db().select().from(txn).where(eq(txn.id, id)).limit(1)
  if (rows[0]?.source !== "manual") return

  await db().delete(txn).where(eq(txn.id, id))
  revalidatePath("/transactions")
  revalidatePath("/")
}

export async function recategoriseAction(): Promise<void> {
  await runCategorisation()
  revalidatePath("/transactions")
  revalidatePath("/")
}

export async function reconcileAction(): Promise<void> {
  await runReconciliation()
  revalidatePath("/transactions")
  revalidatePath("/")
}
