# kontoklar — session log

One entry per build session, newest last. Append; never edit an existing
entry, for the same reason migrations are append-only — a corrected record of
what was decided is no longer a record.

Each entry answers: what was asked, what changed, what was decided and why,
what was rejected, and what is still open.

---

## Scaffolded

**Asked:** create the app.

**Changed:** scaffolded from werft-template — App Router, single-operator
auth, Neon via Drizzle, design tokens, the PR gates, and `@claude` wired to
the operator's Claude subscription.

**Decided:** nothing yet beyond the template's own choices, which are in
AGENTS.md.

**Open:** everything the app is actually for. See ARCHITECTURE.md, which is
still a set of empty headings until the first feature lands.

---

## Build one — the whole product

**Asked:** issue #1, "build this app according to the plan below" — six epics
covering onboarding, tracking and reconciliation, analytics, an AI advisor,
household sharing, and the edge cases that get forgotten.

**Changed:** the app, from the placeholder page to a working product. Migration
`0001_kontoklar` adds nine tables; `src/domain/` holds the arithmetic as pure
functions with unit tests; `src/ai/` holds every model call; `src/data/` holds
the queries and the import pipeline; eight routes render it, all server-side.
`/` is the dashboard, not a link to one.

**Decided, and why:**

*CSV/PDF import rather than bank connectivity.* Taken as recommended in the
brief. Live PSD2/FinTS access needs a licensed aggregator and changes the
compliance surface of the whole product; import gets the same numbers in for
one download a month.

*The AI is an upgrade, never a dependency.* Every screen works with the gateway
switched off, and says so rather than failing. This came out of Epic 6's
"manual mode" story but ended up shaping the whole design: heuristics parse
most CSVs for free, rules categorise before the model is asked, and the model
is the fallback for what is left.

*The model maps columns; code parses rows.* Sending a thousand rows to a model
to be transcribed is both expensive and a way to get a number wrong. It sees
the header row and three samples, and returns a mapping.

*`null` beats a guess.* The categoriser is told an honest "no category" is
worth more than a confident wrong one, and a hallucinated id is treated as no
answer. Unexplained is a visible state with a button next to it.

*Card attribution via a settlement link and a remainder line.* The acceptance
criteria in the brief are implemented literally, including the third: an
unmatched settlement remainder becomes an unexplained spending line on the
card, never a silent drop. `reconcileSettlements` is tested against all three
cases plus "two payments must not claim the same charge".

*The occurrence index in the import fingerprint.* Without it, two identical
€3.20 coffees on one day collapse into one on import. With it, they survive and
a re-import of the same file still collapses correctly.

*Exact-amount transfer matching.* Approximate matching would swallow a real
expense that resembled a transfer. A missed pair costs one click; an invented
one deletes an expense silently.

*Analyses stored as text, not as structured objects.* A past analysis is worth
re-reading, and text survives every future change to the shape of an answer.

*No default categories.* A shipped taxonomy decides what a person's life looks
like, and the first thing they do is delete half of it. Categories arrive from
a draft they accepted or from them typing one.

**Rejected:**

*A charting dependency.* Three chart shapes are less code than the adapter
around a library that draws thirty, and nothing outside the blessed list was
worth a human decision here.

*A PDF library.* `node:zlib` plus the text operators covers ordinary bank PDFs.
Scans are refused with an explanation instead of half-read — OCR is a different
product.

*Adding a colour token.* The eight semantic ones covered every state needed,
and a new one means updating all nine themes for no gain.

*Building Epic 5's separate logins.* AGENTS.md forbids a second user without a
real user store, and that is a decision to raise rather than implement quietly.
What was built instead: the money-meeting screen, which works for one login,
and a `visibility` column so the data model does not have to change later. The
README says plainly what sharing does and does not do.

*Importing the statement during onboarding.* The draft-from-statement route
reads the file to build a budget but does not import the transactions — the
import screen shows what would be created and what is a duplicate first. A
ledger nobody agreed to is worse than one extra click.

**Open:**

- `pnpm build`, `pnpm typecheck` and `pnpm test` could **not be run in this
  session**: the runner had no `pnpm` and blocked `npm`, `npx` and `corepack`,
  so no dependencies could be installed. The code was written to the repo's
  strict settings by inspection — `noUncheckedIndexedAccess` in particular —
  but the PR's own gates are the first real execution. Anything they catch is
  a follow-up commit, not a surprise.
- For the same reason the `0001` migration SQL, its journal entry and its
  snapshot were **hand-written** rather than produced by `drizzle-kit generate`.
  The SQL is what runs at deploy time; the snapshot is the part worth
  regenerating if a later `db:generate` disagrees with it.
- Reconciliation re-runs over the whole table after every import. Fine at
  household scale, wrong at ten times it.
- Alerts are pull-only: an overrun shows when the dashboard is opened. Epic 4's
  proactive alert is half-built — the projection exists, the delivery does not.
- Multi-currency net worth is a straight sum. No conversion, no rates provider.
