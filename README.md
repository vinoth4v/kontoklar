# Kontoklar

Your plan and your reality, reconciled — with an AI that tells you the truth
about the gap.

Kontoklar is a personal finance app for people whose money is spread across
accounts, cards and apps they never see in one place. It imports statements,
works out which lines are actually spending, compares that against the plan,
and then does the thing budgeting apps mostly do not: it audits the result and
ranks what to do about it by what each move is worth in a year.

> Scaffolded from [werft-template](https://github.com/vinoth4v/werft-template).
> The hard rules live in `AGENTS.md`, the design in `docs/ARCHITECTURE.md`,
> and why each change was made in `docs/SESSIONS.md`.

## What it does

**Set up in about ten minutes.** Answer a handful of questions — who earns,
rent or own, what you are committed to — and it drafts a full budget. Or upload
one bank statement and it drafts the budget from what your money actually did,
which is the plan people keep. Or skip both and type it in yourself. There is
no default category set: nothing assumes a family, a country, or a salary.

**Import statements from any bank.** CSV from anywhere, or a PDF. Column layouts
are recognised for free where they can be; where they cannot, the model is
shown the header row and asked which column is which — never the data. German
`1.234,56` and Anglo `1,234.56`, `31.12.2025` and `12/31/2025`, signed amounts
and separate debit/credit columns all read correctly. Re-importing the same file
is safe.

**Reconciliation, which is where the name comes from.** Two things quietly ruin
a monthly picture, and both are handled:

- **Transfers between your own accounts** are paired automatically and excluded,
  so moving €500 to savings is not counted as €500 of spending.
- **Credit cards** are attributed to the month you spent, not the month the bill
  cleared. Link a card to the account that pays it off, and the settlement debit
  stops counting as spending — matched against the charges it settles. Anything
  the payment covers that no charge explains becomes an **unexplained spending**
  line on that card. The difference is never silently dropped.

**Categorisation that gets better because you corrected it.** Every correction
becomes a rule keyed on the payee, applied immediately to everything else it
explains, past and future. Rules run before the model is ever asked, so the same
shop is never paid for twice.

**Analytics that answer "am I fine?"** Savings rate, fixed-cost share, months of
liquidity and net worth as permanent headline numbers; plan-versus-actual per
category per month; balance and spending trends; and a money-flow diagram drawn
from the transfers reconciliation already found, not one you had to draw.

**An advisor with four jobs.** A written monthly analysis ranking moves by €/year.
Scenario questions ("what if my rent rises €200?") answered against your real
numbers with the arithmetic shown. An annual audit for duplicate mandates, dead
subscriptions, charges that crept up, and expenses worth checking against your
country's tax rules. And an allocation for money that is about to arrive, before
it dissolves into consumption.

**A money-meeting screen.** One page: this month's wins, its overruns, and the
single decision worth making. Fifteen minutes, not a spreadsheet review.

**Ten-second entry.** A cash expense is six fields and one button, no JavaScript
required.

**No lock-in.** One click exports everything as JSON, or the transactions as CSV.
One typed word deletes every financial row.

## What works, and what does not

Works today:

- Onboarding by questions, by statement, or by hand
- CSV import from any bank; PDF import where the file has a real text layer
- Transfer detection, card settlement reconciliation, unexplained remainders
- Rules learned from corrections, applied retroactively
- Plan versus actual, headline metrics, trends, money-flow diagram
- Monthly analysis, scenarios, annual audit, windfall allocation
- Money meeting, quick add, full export, full delete
- Multiple currencies per account, and localised money and date formats
- **Every screen without any AI at all.** If the model gateway is unconfigured
  or down, imports still parse known layouts, rules still categorise, and every
  number still computes. AI is an upgrade, never a dependency.

Does not, deliberately:

- **No bank connection.** Live PSD2/FinTS access needs a licensed aggregator and
  changes the compliance surface of the whole product. CSV/PDF import gets the
  same numbers in for one download a month. See ARCHITECTURE for the reasoning.
- **No second login.** The gate is one operator, by the template's rule. Categories
  carry a shared/private flag so the data model is ready, but with one login
  everything is visible — the couple-with-separate-logins story is not built.
- **No scanned-PDF import.** There is no OCR; a PDF with no text layer is refused
  with an explanation rather than half-read.
- **No currency conversion.** Amounts stay in their account's currency; a
  multi-currency net worth is a straight sum today.
- **No proactive notifications.** Overrun warnings appear on the dashboard when
  you visit; nothing emails you.
- **AI advice is information, not regulated financial advice**, and every screen
  that shows it says so.

## Run it

```bash
pnpm install
pnpm dev
```

Environment lives in `apps/web/.env.local`; `apps/web/.env.example` lists what
is needed. `pnpm hash-password` sets the operator password — an app with none
cannot be signed into. `KOMPASS_BASE_URL` and `KOMPASS_TOKEN` enable the AI
features; without them the app runs in manual mode and says so.

```bash
pnpm db:migrate    # apply migrations to DATABASE_URL
pnpm test          # unit tests: parsing, reconciliation, metrics
pnpm build         # the gate that matters
```

## Change it

Say what you want in the app's page on the
[marketplace](https://werft-marketplace.vercel.app), or comment `@claude` on an
issue here. Either way Claude works on a branch and opens a pull request; five
gates run against a real preview on its own database branch, and a human
merges. Nothing reaches production on its own.

## Deployment

Merging to `main` deploys. Migrations are applied to production during that
build, before it starts — a failed migration fails the build and the previous
deployment keeps serving.
