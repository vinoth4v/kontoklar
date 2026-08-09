# kontoklar — architecture

How this app works, in its current form. Rewritten whenever the design
changes, so it describes the present rather than accumulating history —
that is SESSIONS.md's job.

## Purpose

Kontoklar is an AI-assisted personal finance app for people whose money is
spread across accounts, cards, and apps they never see in one place. The
promise is narrower than "budgeting": **the plan and the reality, reconciled,
with the gap explained honestly.**

Two claims follow from that and constrain everything below:

1. **Nothing disappears.** Money that cannot be explained is shown as
   unexplained, never rounded away, never dropped, never counted twice.
2. **The AI is an upgrade, not a dependency.** Every screen works with the model
   gateway switched off. This is a product decision before it is a resilience
   one: an app that stops working when a gateway is down is not one to keep a
   household's money in.

## Domain model

- **Account** — anything money sits in or passes through: a bank account, a
  card, cash in a pocket, a loan. Has its own currency. A **credit card** may
  name the account that settles it; that single link is what makes card
  attribution possible.
- **Category** and **category group** — entirely user-defined. The app ships
  none, because a default set decides what a person's life looks like. A
  category is *income*, *expense* or *savings*, may be marked a **committed
  cost** (which is what the fixed-cost metric counts), and carries a
  shared/private flag.
- **Budget line** — one planned amount, for one category, for one month.
- **Transaction** — one line of money moving, with two dates and a **role**:
  - `spending` — the only role that counts toward a budget
  - `transfer` — the user's own money changing seats
  - `settlement` — a card being paid off, whose spending was already counted
    when each charge was made
  The two dates are `bookedOn` (what the bank says) and `spentOn` (when it was
  actually spent). Every analytic reads `spentOn`.
- **Rule** — a payee fragment mapped to a category, created by the user
  correcting something. Applied before the model is ever asked.
- **Import batch** — one upload, with its counts, so an import can be judged
  after the fact.
- **AI note** — what the model said, kept as text.
- **Unexplained spending** is not a table. It is any `spending` line with no
  category, plus the derived remainder rows reconciliation creates when a card
  payment exceeds the charges that explain it.

## Data model

Money is **signed integer cents** everywhere. No floats: a personal finance app
that reports a rounding error has lost the argument.

Tables, all introduced by migration `0001_kontoklar` except `audit_log`
(`0000_audit_log`, from the template):

| Table | Shape and why |
|---|---|
| `audit_log` | Template's append-only event record. Extended with app kinds — imports, recategorisations, exports, deletions. A deletion is irreversible, so the row saying it happened is the only trace. |
| `account` | Name, kind, institution, optional free-text `owner` (no household taxonomy), currency, opening balance, `settlement_account_id` self-reference for cards, `archived_at`. |
| `category_group` | Name and sort order. Optional; a flat category list is a fine budget. |
| `category` | Group, name, kind, `fixed_cost`, `visibility`, `archived_at`. Archived rather than deleted — deleting a category re-reads every past month as unexplained. |
| `budget_line` | `(category_id, month)` unique, planned cents. Month is `YYYY-MM` text because that is what sorts, groups and joins. |
| `txn` | Both dates, description, counterparty, signed cents, category, role, `transfer_group` (links the two halves of a transfer), `settles_account_id` (which card a settlement closes), source, AI confidence and reason, `confirmed_by_user`, and a unique `external_ref`. |
| `category_rule` | Unique matcher → category, with a hit count. |
| `import_batch` | Filename, parser used, rows parsed/imported/duplicated. |
| `app_setting` | Key/value. A column per preference is a migration per preference. |
| `ai_note` | Kind, subject, optional question, body text. |

**`external_ref` is the deduplication story.** It is a content hash of account,
both dates, amount, description *and which occurrence within its own file the
line is*. That last part matters: two identical €3.20 coffees on one day both
survive, while re-importing the whole statement collapses onto exactly the same
rows. Derived remainder lines use a deterministic `recon:<paymentId>` ref, so
re-running reconciliation updates them in place rather than accumulating copies.

`confirmed_by_user` is the flag that stops automation undoing a human. No
reconciliation or categorisation pass touches a row carrying it.

## Surfaces

Everything is behind the operator gate; the proxy is closed by default and only
`/login` and `/api/auth` are exempt.

| Route | What it is for |
|---|---|
| `/` | **The app.** Headline metrics, alerts, plan versus actual, trends, quick add, latest transactions, money-flow diagram. Redirects to `/onboarding` when no account exists. |
| `/onboarding` | Three ways in — questions, a statement, or by hand. Redirects to `/` once configured. |
| `/transactions` | The ledger and where corrections are made. Category, role and card-settled-by are all editable per row; `?filter=unexplained` reaches every loose end across all months. |
| `/import` | Upload, with the counts told honestly and a list of earlier imports. |
| `/budget` | The plan beside what it produced. One save for the whole grid; copy last month; add categories and groups. |
| `/accounts` | Accounts, balances, and the card→settlement link. |
| `/advisor` | Monthly analysis, scenarios, annual audit, windfall allocation, with every past answer kept. |
| `/meeting` | Wins, overruns, one decision. |
| `/settings` | Locale and currency, the rules it learned, export, delete everything. |
| `/api/export` | JSON of every table, or `?format=csv` for the transactions. Re-checks the session itself rather than trusting the matcher. |

Server actions live beside the page that uses them. All of them are plain
`FormData` actions with no client JavaScript: the whole app renders on the
server, and the only client component is the nav, which needs the pathname to
mark the current link.

## External services

| Service | Configured by | What happens without it |
|---|---|---|
| Neon Postgres | `DATABASE_URL` | Nothing works. Read lazily, never at module scope. |
| Kompass gateway | `KOMPASS_BASE_URL`, `KOMPASS_TOKEN` | Every AI feature is disabled in the UI and the app runs in manual mode. Imports of recognisable CSVs, rules-based categorisation, reconciliation and every metric still work. |
| Auth | `AUTH_SECRET`, `WERFT_USER_EMAIL`, `WERFT_PASSWORD_HASH` | No sign-in. |

Model lanes are chosen per call: `kompass-fast` for column mapping and
categorisation, `kompass-longctx` for reading a PDF's text, `kompass-hard` for
the four advisor features, `kompass-agentic` for budget drafting.

**What the model is sent.** Aggregates and category names — planned and actual
per line, monthly income and spending, headline metrics — plus the payee
fragments of detected recurring charges, because an audit cannot report a
duplicate mandate without naming it. The raw transaction list is never sent for
analysis. Import is the one exception, and a deliberate one: column mapping
sends the header row and up to three sample rows, and PDF extraction sends the
statement's text, because there is no other way to read it.

## Decisions in force

**CSV/PDF import, not bank connectivity.** Live PSD2/FinTS access in Europe
requires a licensed aggregator (finAPI, Tink, GoCardless), which changes the
cost structure and the compliance surface of the entire product. Import
delivers most of the value for one download a month. Revisit only as a
deliberate product decision, not as a feature.

**The model is a fallback parser, never the parser.** Heuristics map most bank
CSVs for free; the model is asked only which column is which, and the rows are
still parsed by code. A thousand-row statement therefore costs one small call,
and no transaction ever depends on a model transcribing a number correctly.

**Rules before the model, always.** A correction is right by definition and free
to apply. The model only sees what nothing else explains.

**`null` beats a guess.** The categoriser is told an honest "no category" is
worth more than a confident wrong one, and a hallucinated category id is treated
as no answer. An unexplained line is visible and has a button next to it; a
confidently miscategorised one is neither.

**Everything the model returns is schema-validated before it reaches the
database,** with one retry that feeds the validation error back. Otherwise a bad
reply becomes a category called `undefined` and a `NaN` budget line.

**Exact-amount transfer matching, within a few days.** Approximate matching
would swallow a real expense that happened to look like a transfer. Missing a
pair costs one click; inventing one silently deletes an expense.

**Archive, never delete** — for accounts and categories both. Deleting either
rewrites history without saying so.

**Analyses are stored as text,** not as the structured object they arrived as.
The value of a past analysis is that it can still be read next month, and text
survives every future change to the shape of an answer.

**Layout widths are literals; colours, spacing and fonts are tokens.** A
container width is a decision about one page, not a value another component
should reach for. No colour token was added: the eight semantic ones covered
everything, and adding one means updating all nine themes.

## Known gaps

- **One login.** The template forbids a second user without a real user store,
  which is a decision to raise rather than implement quietly. `category.visibility`
  records shared/private intent so the model is ready, but nothing enforces it
  and the UI says so plainly. The couple-with-separate-logins and read-only-role
  stories are not built.
- **Reconciliation is O(outgoing × incoming) over the whole table** and re-runs
  after every import. Fine for the thousands of rows a household produces;
  it would want an index-driven rewrite at ten times that.
- **PDF extraction is dependency-free and therefore limited.** It inflates
  content streams and reads text operators, which covers ordinary bank PDFs and
  fails on scans, encrypted files, and layouts that hide text in object streams.
  Refused with an explanation rather than half-read. A PDF library is a
  dependency decision for a human; OCR is a different product.
- **No currency conversion.** Net worth sums accounts of different currencies
  directly. Correct for the common single-currency case, wrong for a genuinely
  multi-currency household.
- **Categorisation is capped at 300 transactions per run.** The rest are picked
  up next time and are visible as unexplained until then.
- **Alerts are pull, not push.** An overrun warning appears when the dashboard
  is opened. There is no scheduled job and no email.
- **Automatic settlement detection needs the card's statement too.** If only the
  paying account is imported, the user marks that payment as a card payment and
  names the card — after which the whole amount becomes unexplained spending on
  that card, which is honest but coarse.
- **The `0001` migration and its snapshot were written by hand,** because the
  session that produced them had no package manager available to run
  `drizzle-kit generate`. The SQL is what matters at deploy time and is
  straightforward; if a future `pnpm db:generate` produces a spurious diff, the
  snapshot is the thing to regenerate.
