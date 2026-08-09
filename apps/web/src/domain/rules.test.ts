import { describe, expect, it } from "vitest"
import { applyRules, findRecurring, groupForCategorisation, matcherFor, normalise } from "./rules.ts"

describe("normalise", () => {
  it("strips the noise a bank puts around a payee", () => {
    expect(
      normalise(
        "SEPA-Lastschrift REWE SAGT DANKE 4711 DE89370400440532013000 12.03.2025",
      ),
    ).toBe("rewe sagt danke")
  })

  it("keeps German letters, which are part of the name", () => {
    expect(normalise("Bäckerei Müller GmbH")).toBe("bäckerei müller gmbh")
  })
})

describe("matcherFor", () => {
  it("keys on the counterparty when there is one", () => {
    expect(matcherFor({ counterparty: "REWE Markt GmbH", description: "Kartenzahlung" })).toBe(
      "rewe markt gmbh",
    )
  })

  it("falls back to the description", () => {
    expect(matcherFor({ counterparty: null, description: "Netflix monthly" })).toBe(
      "netflix monthly",
    )
  })

  it("returns null when there is nothing to key on", () => {
    expect(matcherFor({ counterparty: null, description: "12.03.2025" })).toBeNull()
  })
})

describe("applyRules", () => {
  const rules = [
    { matcher: "amazon", categoryId: "shopping" },
    { matcher: "amazon prime", categoryId: "subscriptions" },
  ]

  it("prefers the longest matcher, so the specific rule wins", () => {
    // Otherwise a subscription lands in shopping forever and the user corrects
    // the same thing every month.
    expect(applyRules({ counterparty: null, description: "AMAZON PRIME MEMBERSHIP" }, rules)).toBe(
      "subscriptions",
    )
    expect(applyRules({ counterparty: null, description: "AMAZON EU SARL" }, rules)).toBe("shopping")
  })

  it("says nothing when nothing matches", () => {
    expect(applyRules({ counterparty: null, description: "Bakery" }, rules)).toBeNull()
  })
})

describe("groupForCategorisation", () => {
  it("puts the same payee in one bucket, so one question covers many rows", () => {
    const groups = groupForCategorisation([
      { counterparty: "REWE Markt GmbH", description: "Kartenzahlung 01" },
      { counterparty: "REWE Markt GmbH", description: "Kartenzahlung 02" },
      { counterparty: "Netflix", description: "Abo" },
    ])

    expect(groups.size).toBe(2)
    expect(groups.get("rewe markt gmbh")).toHaveLength(2)
  })
})

describe("findRecurring", () => {
  it("finds a monthly charge", () => {
    const charges = ["2025-01-05", "2025-02-05", "2025-03-05", "2025-04-05"].map((spentOn) => ({
      counterparty: null,
      description: "Netflix",
      spentOn,
      amountCents: -1299,
    }))

    const [found] = findRecurring(charges)

    expect(found?.matcher).toBe("netflix")
    expect(found?.occurrences).toBe(4)
    expect(found?.averageCents).toBe(-1299)
    expect(found?.averageIntervalDays).toBeGreaterThan(27)
    expect(found?.lastSeen).toBe("2025-04-05")
  })

  it("is not fooled by a shop you visit often", () => {
    const visits = ["2025-01-02", "2025-01-05", "2025-01-09", "2025-01-14"].map((spentOn) => ({
      counterparty: "REWE",
      description: "Kartenzahlung",
      spentOn,
      amountCents: -3210,
    }))

    expect(findRecurring(visits)).toHaveLength(0)
  })

  it("ignores income and one-offs", () => {
    expect(
      findRecurring([
        { counterparty: null, description: "Salary", spentOn: "2025-01-31", amountCents: 300000 },
        { counterparty: null, description: "Salary", spentOn: "2025-02-28", amountCents: 300000 },
        { counterparty: null, description: "Salary", spentOn: "2025-03-31", amountCents: 300000 },
      ]),
    ).toHaveLength(0)
  })
})
