import { db } from "@/db/client"
import { auditLog } from "@/db/schema"

/**
 * The template's two, plus what Kontoklar does that is worth recovering after
 * the fact. `data_deleted` and `data_exported` are the ones that matter most:
 * they are irreversible from the app's point of view, and the audit row is the
 * only evidence they happened.
 */
export type AuditKind =
  | "sign_in"
  | "sign_in_failed"
  | "txn_added"
  | "txn_recategorised"
  | "statement_imported"
  | "budget_changed"
  | "account_changed"
  | "settings_changed"
  | "ai_asked"
  | "data_exported"
  | "data_deleted"

/**
 * Write an audit row, swallowing failures.
 *
 * Auditing is observability, not correctness: an unreachable database must
 * never be able to lock the only operator out of their own app.
 */
export async function recordEvent(
  kind: AuditKind,
  actor: string | null,
  detail?: string,
): Promise<void> {
  try {
    await db()
      .insert(auditLog)
      .values({ kind, actor, detail: detail ?? null })
  } catch (error) {
    console.error(`audit_log write failed for "${kind}"`, error)
  }
}
