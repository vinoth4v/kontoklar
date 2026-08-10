"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  allocateWindfall,
  annualAudit,
  answerScenario,
  monthlyAnalysis,
} from "@/ai/advisor"
import { AiUnavailable } from "@/ai/json"
import { buildSnapshot } from "@/data/snapshot"
import { saveNote } from "@/data/store"
import { loadMonthView } from "@/data/view"
import { recordEvent } from "@/db/events"
import { formatMoney, parseAmountToCents } from "@/domain/money"

/**
 * Every advisor feature follows the same shape: build the snapshot, ask,
 * render the answer to text, store it.
 *
 * Stored as text rather than as the structured object it arrived as, on
 * purpose. The value of a past analysis is that it can be read next month,
 * and text survives every future change to the schema of an answer.
 */

function fail(message: string): never {
  redirect(`/advisor?error=${encodeURIComponent(message)}`)
}

function message(error: unknown): string {
  return error instanceof AiUnavailable
    ? `The advisor is unavailable right now: ${error.message}`
    : `The advisor failed: ${error instanceof Error ? error.message : String(error)}`
}

export async function analyseAction(form: FormData): Promise<void> {
  const view = await loadMonthView(String(form.get("month") ?? ""))
  const snapshot = buildSnapshot(view)
  const money = (cents: number) => formatMoney(cents, view.settings.currency, view.settings.locale)

  let body: string | null = null
  let problem: string | null = null

  try {
    const analysis = await monthlyAnalysis(snapshot)
    body = [
      analysis.verdict,
      "",
      ...analysis.moves
        .slice()
        .sort((a, b) => b.annualImpactCents - a.annualImpactCents)
        .map(
          (move) =>
            `• ${move.title} — ${money(move.annualImpactCents)} a year (${move.confidence} confidence)\n${move.detail}`,
        ),
      analysis.watch.length > 0 ? "\nWatch:" : "",
      ...analysis.watch.map((item) => `• ${item}`),
    ]
      .filter((part) => part !== "")
      .join("\n\n")
  } catch (error) {
    problem = message(error)
  }

  if (problem || !body) fail(problem ?? "No analysis came back.")

  await saveNote("monthly", view.month, body)
  await recordEvent("ai_asked", null, `monthly analysis for ${view.month}`)
  revalidatePath("/advisor")
  redirect(`/advisor?month=${view.month}`)
}

export async function auditAction(form: FormData): Promise<void> {
  const view = await loadMonthView(String(form.get("month") ?? ""))
  const snapshot = buildSnapshot(view)
  const money = (cents: number) => formatMoney(cents, view.settings.currency, view.settings.locale)

  let body: string | null = null
  let problem: string | null = null

  try {
    const audit = await annualAudit(snapshot)
    body = [
      audit.summary,
      "",
      ...audit.findings
        .slice()
        .sort((a, b) => b.annualImpactCents - a.annualImpactCents)
        .map(
          (finding) =>
            `• [${finding.kind.replace("_", " ")}] ${finding.title} — ${money(finding.annualImpactCents)} a year (${finding.confidence} confidence)\n${finding.detail}`,
        ),
    ]
      .filter((part) => part !== "")
      .join("\n\n")
  } catch (error) {
    problem = message(error)
  }

  if (problem || !body) fail(problem ?? "No audit came back.")

  await saveNote("audit", view.month, body)
  await recordEvent("ai_asked", null, "annual audit")
  revalidatePath("/advisor")
  redirect(`/advisor?month=${view.month}`)
}

export async function scenarioAction(form: FormData): Promise<void> {
  const question = String(form.get("question") ?? "").trim()
  if (question === "") fail("Ask something first.")

  const view = await loadMonthView(String(form.get("month") ?? ""))
  const snapshot = buildSnapshot(view)
  const money = (cents: number) => formatMoney(cents, view.settings.currency, view.settings.locale)

  let body: string | null = null
  let problem: string | null = null

  try {
    const answer = await answerScenario(question.slice(0, 500), snapshot)
    body = [
      answer.answer,
      answer.numbers.length > 0 ? "\nThe arithmetic:" : "",
      ...answer.numbers.map((entry) => `• ${entry.label}: ${money(entry.valueCents)}`),
      answer.caveats.length > 0 ? "\nCaveats:" : "",
      ...answer.caveats.map((caveat) => `• ${caveat}`),
    ]
      .filter((part) => part !== "")
      .join("\n\n")
  } catch (error) {
    problem = message(error)
  }

  if (problem || !body) fail(problem ?? "No answer came back.")

  await saveNote("scenario", view.month, body, question.slice(0, 500))
  await recordEvent("ai_asked", null, "scenario")
  revalidatePath("/advisor")
  redirect(`/advisor?month=${view.month}`)
}

export async function windfallAction(form: FormData): Promise<void> {
  const amountCents = parseAmountToCents(String(form.get("amount") ?? ""))
  if (amountCents === null || amountCents === 0) fail("How much is arriving?")

  const note = String(form.get("note") ?? "").slice(0, 500)
  const view = await loadMonthView(String(form.get("month") ?? ""))
  const snapshot = buildSnapshot(view)
  const money = (cents: number) => formatMoney(cents, view.settings.currency, view.settings.locale)

  let body: string | null = null
  let problem: string | null = null

  try {
    const allocation = await allocateWindfall(Math.abs(amountCents), note, snapshot)
    body = [
      allocation.summary,
      "",
      ...allocation.allocations.map(
        (entry) => `• ${entry.label}: ${money(entry.amountCents)}\n${entry.reason}`,
      ),
    ]
      .filter((part) => part !== "")
      .join("\n\n")
  } catch (error) {
    problem = message(error)
  }

  if (problem || !body) fail(problem ?? "No allocation came back.")

  await saveNote(
    "windfall",
    view.month,
    body,
    `${money(Math.abs(amountCents))}${note ? ` — ${note}` : ""}`,
  )
  await recordEvent("ai_asked", null, "windfall allocation")
  revalidatePath("/advisor")
  redirect(`/advisor?month=${view.month}`)
}
