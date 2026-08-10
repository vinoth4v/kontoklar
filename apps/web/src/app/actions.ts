"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { signOut } from "@/auth"
import { db } from "@/db/client"
import { txn } from "@/db/schema"
import { recordEvent } from "@/db/events"
import { parseAmountToCents } from "@/domain/money"

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" })
}

const quickAdd = z.object({
  accountId: z.uuid(),
  categoryId: z.string(),
  amount: z.string().min(1),
  description: z.string().max(500),
  spentOn: z.string().min(1),
  direction: z.enum(["out", "in"]),
})

/**
 * Ten seconds, on a phone, standing in a shop.
 *
 * Six fields, no JavaScript, no confirmation step. The direction toggle exists
 * because the fastest way to enter a cash expense is not to have to remember a
 * minus sign, and the amount is stored signed regardless of how it was typed.
 */
export async function quickAddAction(form: FormData): Promise<void> {
  const parsed = quickAdd.safeParse({
    accountId: form.get("accountId"),
    categoryId: form.get("categoryId") ?? "",
    amount: form.get("amount"),
    description: form.get("description") ?? "",
    spentOn: form.get("spentOn"),
    direction: form.get("direction") ?? "out",
  })

  if (!parsed.success) redirect("/?added=invalid")

  const cents = parseAmountToCents(parsed.data.amount)
  if (cents === null || cents === 0) redirect("/?added=invalid")

  const magnitude = Math.abs(cents)
  const amountCents = parsed.data.direction === "out" ? -magnitude : magnitude

  await db()
    .insert(txn)
    .values({
      accountId: parsed.data.accountId,
      bookedOn: parsed.data.spentOn,
      spentOn: parsed.data.spentOn,
      description: parsed.data.description.trim() || "Cash expense",
      amountCents,
      categoryId: parsed.data.categoryId === "" ? null : parsed.data.categoryId,
      role: "spending",
      source: "manual",
      // Typed by a human, so it is right by definition and no later pass may
      // recategorise it.
      confirmedByUser: parsed.data.categoryId !== "",
    })

  await recordEvent("txn_added", null, `${amountCents} cents on ${parsed.data.spentOn}`)
  revalidatePath("/")
  revalidatePath("/transactions")
  redirect("/?added=1")
}
