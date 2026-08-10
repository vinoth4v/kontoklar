import { describe, expect, it } from "vitest"
import {
  addMonths,
  centsToInput,
  daysBetween,
  formatMoney,
  monthOf,
  parseAmountToCents,
  parseDate,
  recentMonths,
} from "./money.ts"

describe("parseAmountToCents", () => {
  it("reads the two ways the world writes a thousand and a bit", () => {
    expect(parseAmountToCents("1.234,56")).toBe(123456)
    expect(parseAmountToCents("1,234.56")).toBe(123456)
  })

  it("treats a lone separator with three digits after it as thousands", () => {
    // The ambiguous case that decides whether a €1,234 rent is read as €1.23.
    expect(parseAmountToCents("1.234")).toBe(123400)
    expect(parseAmountToCents("1,234")).toBe(123400)
    expect(parseAmountToCents("1.23")).toBe(123)
    expect(parseAmountToCents("1,23")).toBe(123)
  })

  it("understands every way a bank writes a negative", () => {
    expect(parseAmountToCents("-12,50")).toBe(-1250)
    expect(parseAmountToCents("12,50-")).toBe(-1250)
    expect(parseAmountToCents("(12.50)")).toBe(-1250)
    expect(parseAmountToCents("+12,50")).toBe(1250)
  })

  it("ignores currency symbols and spacing", () => {
    expect(parseAmountToCents(" € 1.234,56 ")).toBe(123456)
    expect(parseAmountToCents("$1,234.56")).toBe(123456)
    expect(parseAmountToCents("1 234,56 EUR")).toBe(123456)
  })

  it("pads a single decimal digit rather than misreading it", () => {
    expect(parseAmountToCents("3,5")).toBe(350)
  })

  it("returns null rather than zero for anything unreadable", () => {
    // Zero would be silently wrong in a ledger; null is visibly wrong.
    expect(parseAmountToCents("")).toBeNull()
    expect(parseAmountToCents("   ")).toBeNull()
    expect(parseAmountToCents("Saldo")).toBeNull()
    expect(parseAmountToCents("1-2")).toBeNull()
  })
})

describe("centsToInput", () => {
  it("round-trips through the parser", () => {
    for (const cents of [0, 5, 99, 100, -1250, 123456, -7]) {
      expect(parseAmountToCents(centsToInput(cents))).toBe(cents)
    }
  })
})

describe("parseDate", () => {
  it("prefers ISO, which is unambiguous", () => {
    expect(parseDate("2025-03-07")).toBe("2025-03-07")
    expect(parseDate("2025-3-7")).toBe("2025-03-07")
  })

  it("reads day-first formats", () => {
    expect(parseDate("31.12.2025")).toBe("2025-12-31")
    expect(parseDate("07/03/2025")).toBe("2025-03-07")
    expect(parseDate("31.12.25")).toBe("2025-12-31")
  })

  it("flips to month-first when day-first is impossible", () => {
    expect(parseDate("12/31/2025")).toBe("2025-12-31")
  })

  it("rejects dates that do not exist", () => {
    expect(parseDate("31.02.2025")).toBeNull()
    expect(parseDate("nonsense")).toBeNull()
    expect(parseDate("")).toBeNull()
  })
})

describe("months", () => {
  it("adds across a year boundary in both directions", () => {
    expect(addMonths("2025-01", -1)).toBe("2024-12")
    expect(addMonths("2024-12", 1)).toBe("2025-01")
    expect(addMonths("2025-06", 12)).toBe("2026-06")
    expect(addMonths("2025-06", -18)).toBe("2023-12")
  })

  it("lists recent months newest first", () => {
    expect(recentMonths("2025-03", 3)).toEqual(["2025-03", "2025-02", "2025-01"])
  })

  it("takes the month of a date", () => {
    expect(monthOf("2025-03-07")).toBe("2025-03")
  })
})

describe("daysBetween", () => {
  it("is unsigned and crosses months", () => {
    expect(daysBetween("2025-03-01", "2025-03-04")).toBe(3)
    expect(daysBetween("2025-03-04", "2025-03-01")).toBe(3)
    expect(daysBetween("2025-02-27", "2025-03-02")).toBe(3)
  })
})

describe("formatMoney", () => {
  it("never throws on a bad currency or locale", () => {
    // A formatting error must not be able to take a page down.
    expect(formatMoney(1250, "NOTACURRENCY", "de-DE")).toContain("12.50")
    expect(formatMoney(1250, "EUR", "not-a-locale")).toContain("12.50")
  })
})
