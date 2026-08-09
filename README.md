# Kontoklar

Kontoklar is an AI-assisted personal finance app for people whose money is spread across accounts, cards, and apps they never see in one place

> Scaffolded from [werft-template](https://github.com/vinoth4v/werft-template).
> The hard rules live in `AGENTS.md`, the design in `docs/ARCHITECTURE.md`,
> and why each change was made in `docs/SESSIONS.md`.

## What it does

_Replace this with what someone can actually do with the app today, in the
words they would use. Not a feature list of intentions — the things that work._

## What works, and what does not

_Two short lists, kept honest. The second one is the more useful: it stops a
reader assuming a gap is a bug, and stops the next session rebuilding something
that was deliberately left out. Deeper reasoning belongs in
`docs/ARCHITECTURE.md` under Known gaps; this is the summary._

## Run it

```bash
pnpm install
pnpm dev
```

Environment lives in `apps/web/.env.local`; `apps/web/.env.example` lists what
is needed. `pnpm hash-password` sets the operator password — an app with none
cannot be signed into.

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
