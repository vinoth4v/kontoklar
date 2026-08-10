"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { saveSettings } from "@/data/store"
import { db } from "@/db/client"
import {
  account,
  aiNote,
  budgetLine,
  category,
  categoryGroup,
  categoryRule,
  importBatch,
  txn,
} from "@/db/schema"
import { recordEvent } from "@/db/events"

export async function saveSettingsAction(form: FormData): Promise<void> {
  const parsed = z
    .object({
      householdName: z.string().min(1).max(80),
      country: z.string().min(2).max(2),
      currency: z.string().min(3).max(3),
      locale: z.string().min(2).max(10),
    })
    .safeParse({
      householdName: form.get("householdName"),
      country: String(form.get("country") ?? "").toUpperCase(),
      currency: String(form.get("currency") ?? "").toUpperCase(),
      locale: form.get("locale"),
    })

  if (!parsed.success) redirect("/settings?error=Those%20settings%20were%20not%20accepted.")

  await saveSettings(parsed.data)
  await recordEvent("settings_changed", null, `${parsed.data.country}/${parsed.data.currency}`)
  revalidatePath("/")
  revalidatePath("/settings")
  redirect("/settings?saved=1")
}

/**
 * One click out.
 *
 * Deletes everything this app knows about the user's money, in dependency
 * order, and leaves the account itself alone — the login lives in the
 * environment, not the database, so there is no user row to remove. The typed
 * confirmation is the only guard, because an undo for this would mean keeping
 * the data that was just asked to be destroyed.
 */
export async function deleteEverythingAction(form: FormData): Promise<void> {
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== "delete") {
    redirect("/settings?error=Type%20delete%20to%20confirm.")
  }

  await db().delete(txn)
  await db().delete(budgetLine)
  await db().delete(categoryRule)
  await db().delete(category)
  await db().delete(categoryGroup)
  await db().delete(importBatch)
  await db().delete(account)
  await db().delete(aiNote)

  // The audit row is written after the fact and deliberately survives: what
  // was deleted is gone, that it happened is not.
  await recordEvent("data_deleted", null, "every financial row removed on request")

  revalidatePath("/")
  redirect("/onboarding")
}
