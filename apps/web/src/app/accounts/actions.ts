"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { runReconciliation } from "@/data/pipeline"
import { createAccount, updateAccount } from "@/data/setup"
import { db } from "@/db/client"
import { account, ACCOUNT_KINDS } from "@/db/schema"
import { recordEvent } from "@/db/events"
import { parseAmountToCents } from "@/domain/money"

const fields = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(ACCOUNT_KINDS),
  institution: z.string().max(80).optional(),
  owner: z.string().max(80).optional(),
  currency: z.string().min(3).max(3),
  openingBalance: z.string().optional(),
  settlementAccountId: z.string().optional(),
})

function read(form: FormData) {
  return fields.safeParse({
    name: form.get("name"),
    kind: form.get("kind"),
    institution: form.get("institution") ?? "",
    owner: form.get("owner") ?? "",
    currency: String(form.get("currency") ?? "EUR").toUpperCase(),
    openingBalance: form.get("openingBalance") ?? "",
    settlementAccountId: form.get("settlementAccountId") ?? "",
  })
}

export async function createAccountAction(form: FormData): Promise<void> {
  const parsed = read(form)
  if (!parsed.success) return

  await createAccount({
    name: parsed.data.name,
    kind: parsed.data.kind,
    institution: parsed.data.institution || null,
    owner: parsed.data.owner || null,
    currency: parsed.data.currency,
    openingBalanceCents: parseAmountToCents(parsed.data.openingBalance ?? "") ?? 0,
    settlementAccountId: parsed.data.settlementAccountId || null,
  })

  await recordEvent("account_changed", null, `created ${parsed.data.name}`)
  // A new card with a settlement account can change how existing payments are
  // read, so the whole reconciliation is re-derived rather than left stale.
  await runReconciliation()
  revalidatePath("/accounts")
  revalidatePath("/")
}

export async function updateAccountAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "")
  const parsed = read(form)
  if (!id || !parsed.success) return

  await updateAccount(id, {
    name: parsed.data.name,
    kind: parsed.data.kind,
    institution: parsed.data.institution || null,
    owner: parsed.data.owner || null,
    currency: parsed.data.currency,
    openingBalanceCents: parseAmountToCents(parsed.data.openingBalance ?? "") ?? 0,
    settlementAccountId: parsed.data.settlementAccountId || null,
  })

  await recordEvent("account_changed", null, `updated ${parsed.data.name}`)
  await runReconciliation()
  revalidatePath("/accounts")
  revalidatePath("/")
}

/**
 * Archive rather than delete.
 *
 * Deleting an account would cascade its transactions away, which silently
 * rewrites months of history. Archiving keeps the numbers and takes the
 * account out of the way.
 */
export async function archiveAccountAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "")
  if (!id) return

  const rows = await db().select().from(account).where(eq(account.id, id)).limit(1)
  const current = rows[0]
  if (!current) return

  await db()
    .update(account)
    .set({ archivedAt: current.archivedAt ? null : new Date() })
    .where(eq(account.id, id))

  await recordEvent("account_changed", null, `${current.archivedAt ? "restored" : "archived"} ${current.name}`)
  revalidatePath("/accounts")
  revalidatePath("/")
}
