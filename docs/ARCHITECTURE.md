# kontoklar — architecture

How this app works, in its current form. Rewritten whenever the design
changes, so it describes the present rather than accumulating history —
that is SESSIONS.md's job.

## Purpose

Kontoklar is an AI-assisted personal finance app for people whose money is spread across accounts, cards, and apps they never see in one place

## Domain model

_The things this app talks about, and how they relate. Not tables — concepts._

## Data model

_Tables, their columns, and why they are shaped that way. Name the migration
that introduced each one, so a schema question can be traced to its change._

## Surfaces

_Routes, server actions and API endpoints, with what each one is for and who
may reach it. Everything is behind the operator gate unless stated here._

## External services

_Databases, buckets, model lanes, third-party APIs — and which environment
variable configures each. Anything that costs money or can fail belongs here._

## Decisions in force

_Choices that constrain future work, and the reason each one was made. A
decision without its reason gets reversed by the next session that finds it
inconvenient._

## Known gaps

_What is deliberately missing or unfinished, so it is not mistaken for an
oversight and quietly "fixed" in the wrong direction._
