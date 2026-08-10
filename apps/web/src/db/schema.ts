import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

/**
 * Append-only record of things worth knowing after the fact: sign-ins,
 * failed sign-ins, and whatever the app built on this template adds.
 *
 * A single-operator app has no admin console, so this table is the only
 * place a past event is recoverable from.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    actor: text("actor"),
    detail: text("detail"),
  },
  (table) => [index("audit_log_at_idx").on(table.at)],
)

export type AuditLogRow = typeof auditLog.$inferSelect
export type NewAuditLogRow = typeof auditLog.$inferInsert

/**
 * Money is always signed integer cents in the account's own currency. No
 * floats anywhere: 0.1 + 0.2 is a rounding bug waiting to be reported as
 * "the budget is off by a cent", and there is no reason to accept it.
 */

export const ACCOUNT_KINDS = [
  "checking",
  "savings",
  "credit_card",
  "cash",
  "investment",
  "loan",
] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]

/**
 * An account is anything money sits in or passes through — a bank account, a
 * card, the cash in a pocket. No fixed taxonomy of *whose* it is: the app
 * cannot assume a household shape, so an account carries only an optional
 * `owner` label the user writes themselves.
 *
 * `settlementAccountId` is what makes credit cards work. A card's charges are
 * spending on the day they are made; the monthly debit that settles the card
 * is not spending at all, it is a transfer. The link says which account that
 * debit will arrive on so reconciliation can find it.
 */
export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").$type<AccountKind>().notNull(),
    institution: text("institution"),
    owner: text("owner"),
    currency: text("currency").notNull().default("EUR"),
    openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
    settlementAccountId: uuid("settlement_account_id").references(
      (): AnyPgColumn => account.id,
      { onDelete: "set null" },
    ),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_kind_idx").on(table.kind)],
)

export type AccountRow = typeof account.$inferSelect
export type NewAccountRow = typeof account.$inferInsert

/** A named drawer for categories. Entirely user-defined — the app ships none. */
export const categoryGroup = pgTable("category_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type CategoryGroupRow = typeof categoryGroup.$inferSelect

export const CATEGORY_KINDS = ["income", "expense", "savings"] as const
export type CategoryKind = (typeof CATEGORY_KINDS)[number]

export const CATEGORY_VISIBILITIES = ["shared", "private"] as const
export type CategoryVisibility = (typeof CATEGORY_VISIBILITIES)[number]

/**
 * `fixedCost` is not decoration: fixed-cost share is a headline metric, and
 * "which of these is rent-like" is a judgement only the user (or the AI, with
 * the user correcting it) can make.
 *
 * `visibility` exists so the data model does not have to change when separate
 * logins arrive. Today one operator sees everything; the column records intent
 * rather than enforcing it, which the UI says plainly.
 */
export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").references(() => categoryGroup.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: text("kind").$type<CategoryKind>().notNull().default("expense"),
    fixedCost: boolean("fixed_cost").notNull().default(false),
    visibility: text("visibility").$type<CategoryVisibility>().notNull().default("shared"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("category_group_idx").on(table.groupId)],
)

export type CategoryRow = typeof category.$inferSelect

/** One planned amount, for one category, for one `YYYY-MM`. */
export const budgetLine = pgTable(
  "budget_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    plannedCents: integer("planned_cents").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("budget_line_category_month_key").on(table.categoryId, table.month),
    index("budget_line_month_idx").on(table.month),
  ],
)

export type BudgetLineRow = typeof budgetLine.$inferSelect

export const TXN_ROLES = ["spending", "transfer", "settlement"] as const
export type TxnRole = (typeof TXN_ROLES)[number]

export const TXN_SOURCES = ["import", "manual", "reconciliation"] as const
export type TxnSource = (typeof TXN_SOURCES)[number]

/**
 * One line of money moving.
 *
 * `bookedOn` is when the bank says it happened; `spentOn` is when it was
 * actually spent. They differ for card charges, and the whole month's picture
 * differs with them — every analytic reads `spentOn`, and `bookedOn` survives
 * only so an import can be traced back to the statement it came from.
 *
 * `role` separates the three things a line can be. Only `spending` counts
 * toward a budget: `transfer` is the user's own money changing seats, and
 * `settlement` is a card being paid off, whose spending was already counted
 * when each charge was made.
 *
 * `externalRef` is a content hash. Re-importing the same statement is the
 * normal case, not the exception, so duplicates are rejected by construction
 * rather than by the user noticing.
 */
export const txn = pgTable(
  "txn",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    bookedOn: date("booked_on").notNull(),
    spentOn: date("spent_on").notNull(),
    description: text("description").notNull().default(""),
    counterparty: text("counterparty"),
    amountCents: integer("amount_cents").notNull(),
    categoryId: uuid("category_id").references(() => category.id, { onDelete: "set null" }),
    role: text("role").$type<TxnRole>().notNull().default("spending"),
    transferGroup: uuid("transfer_group"),
    /** For a settlement: which card this payment closes. Set by reconciliation
     * when the card's own statement is present, and by the user when it is not
     * — the second case is the whole reason the column exists, because a card
     * payment with no imported charges is still a month of real spending and
     * has to be attributed somewhere rather than dropped. */
    settlesAccountId: uuid("settles_account_id").references((): AnyPgColumn => account.id, {
      onDelete: "set null",
    }),
    source: text("source").$type<TxnSource>().notNull().default("manual"),
    importId: uuid("import_id"),
    aiConfidence: integer("ai_confidence"),
    aiReason: text("ai_reason"),
    confirmedByUser: boolean("confirmed_by_user").notNull().default(false),
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("txn_external_ref_key").on(table.externalRef),
    index("txn_spent_on_idx").on(table.spentOn),
    index("txn_account_idx").on(table.accountId),
    index("txn_category_idx").on(table.categoryId),
  ],
)

export type TxnRow = typeof txn.$inferSelect
export type NewTxnRow = typeof txn.$inferInsert

/**
 * A correction, remembered.
 *
 * Every time the user recategorises something, the counterparty it matched
 * becomes a rule. Rules are applied before the model is ever asked, so
 * accuracy compounds and the same mistake is not paid for twice — in money or
 * in the user's patience.
 */
export const categoryRule = pgTable(
  "category_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matcher: text("matcher").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    hits: integer("hits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("category_rule_matcher_key").on(table.matcher)],
)

export type CategoryRuleRow = typeof categoryRule.$inferSelect

/** One upload. Kept so a bad import can be found and undone wholesale. */
export const importBatch = pgTable("import_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").references(() => account.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  parsedRows: integer("parsed_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  parser: text("parser").notNull().default("csv"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type ImportBatchRow = typeof importBatch.$inferSelect

/** Key/value, because the settings a personal finance app needs are few and
 * adding a column for each one is a migration per preference. */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const AI_NOTE_KINDS = ["monthly", "audit", "scenario", "windfall"] as const
export type AiNoteKind = (typeof AI_NOTE_KINDS)[number]

/**
 * What the model said, kept.
 *
 * Analyses cost a real call and are worth re-reading; a scenario answer is
 * only meaningful beside the question that produced it. Storing both also
 * makes the advice auditable after the fact, which matters more than usual
 * when the subject is somebody's money.
 */
export const aiNote = pgTable(
  "ai_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<AiNoteKind>().notNull(),
    subject: text("subject").notNull(),
    question: text("question"),
    body: text("body").notNull(),
    lane: text("lane"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_note_kind_idx").on(table.kind, table.createdAt)],
)

export type AiNoteRow = typeof aiNote.$inferSelect
