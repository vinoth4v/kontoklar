"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { AiUnavailable } from "@/ai/json"
import { ImportProblem, importStatement } from "@/data/pipeline"
import { recordEvent } from "@/db/events"

/**
 * One upload, one outcome, told honestly.
 *
 * The counts that come back — parsed, imported, duplicate, rejected — are the
 * whole point. An importer that says "done" is an importer you cannot trust
 * with a statement you only have one copy of.
 */
export async function importAction(form: FormData): Promise<void> {
  const accountId = String(form.get("accountId") ?? "")
  const file = form.get("statement")
  const useAi = form.get("useAi") === "on"

  if (!accountId) redirect("/import?error=Choose%20which%20account%20this%20statement%20belongs%20to.")
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?error=Choose%20a%20file%20first.")
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let outcome: Awaited<ReturnType<typeof importStatement>> | null = null
  // Collected rather than thrown, because `redirect` throws and would be
  // swallowed by this function's own catch.
  let problem: string | null = null

  try {
    outcome = await importStatement(accountId, file.name, bytes, { useAi })
  } catch (error) {
    problem =
      error instanceof ImportProblem || error instanceof AiUnavailable
        ? error.message
        : `That file could not be imported: ${error instanceof Error ? error.message : String(error)}`
  }

  if (problem || !outcome) redirect(`/import?error=${encodeURIComponent(problem ?? "Unknown failure.")}`)

  await recordEvent(
    "statement_imported",
    null,
    `${file.name}: ${outcome.imported} imported, ${outcome.duplicates} duplicates, ${outcome.rejected} unreadable`,
  )

  revalidatePath("/")
  revalidatePath("/transactions")
  redirect(`/import?batch=${outcome.batchId}`)
}
