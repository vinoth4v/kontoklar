import { describe, expect, it } from "vitest"
import {
  applyColumnMap,
  fingerprint,
  fingerprintAll,
  guessColumns,
  parseCsv,
  sniffDelimiter,
  splitLine,
} from "./csv.ts"

const GERMAN = [
  "Umsatzanzeige;;;;",
  "Von;01.01.2025;bis;31.01.2025;",
  "Buchungstag;Valutadatum;Verwendungszweck;Empfänger;Betrag",
  "02.01.2025;03.01.2025;REWE SAGT DANKE;REWE Markt GmbH;-45,20",
  "05.01.2025;05.01.2025;Gehalt Januar;Arbeitgeber AG;3.250,00",
  "07.01.2025;07.01.2025;Miete;Vermieter;-1.100,00",
].join("\n")

const ANGLO = [
  "Date,Description,Debit,Credit",
  '2025-01-02,"Coffee, large",3.20,',
  "2025-01-05,Salary,,3250.00",
].join("\n")

describe("splitLine", () => {
  it("honours quotes and doubled quotes", () => {
    expect(splitLine('a;"b;c";d', ";")).toEqual(["a", "b;c", "d"])
    expect(splitLine('"he said ""hi""";x', ";")).toEqual(['he said "hi"', "x"])
  })
})

describe("sniffDelimiter", () => {
  it("picks the separator that yields the most consistent columns", () => {
    expect(sniffDelimiter(GERMAN.split("\n"))).toBe(";")
    expect(sniffDelimiter(ANGLO.split("\n"))).toBe(",")
  })
})

describe("parseCsv", () => {
  it("skips a bank's preamble and finds the real header", () => {
    const table = parseCsv(GERMAN)

    expect(table.skipped).toHaveLength(2)
    expect(table.headers).toEqual([
      "Buchungstag",
      "Valutadatum",
      "Verwendungszweck",
      "Empfänger",
      "Betrag",
    ])
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0]?.Betrag).toBe("-45,20")
  })

  it("names blank and duplicate headers rather than losing the column", () => {
    const table = parseCsv("a;;a\n1;2;3")
    expect(table.headers).toEqual(["a", "column_2", "a_2"])
    expect(table.rows[0]?.a_2).toBe("3")
  })
})

describe("guessColumns", () => {
  it("maps a German statement, keeping booking and value dates apart", () => {
    const map = guessColumns(parseCsv(GERMAN).headers)

    expect(map).not.toBeNull()
    expect(map?.date).toBe("Buchungstag")
    expect(map?.valueDate).toBe("Valutadatum")
    expect(map?.description).toBe("Verwendungszweck")
    expect(map?.counterparty).toBe("Empfänger")
    expect(map?.amount).toBe("Betrag")
  })

  it("maps split debit and credit columns", () => {
    const map = guessColumns(parseCsv(ANGLO).headers)

    expect(map?.date).toBe("Date")
    expect(map?.debit).toBe("Debit")
    expect(map?.credit).toBe("Credit")
    expect(map?.amount).toBeUndefined()
  })

  it("gives up rather than guessing when there is no amount", () => {
    // Escalating to the model beats importing a column that might be a balance.
    expect(guessColumns(["Datum", "Notiz"])).toBeNull()
    expect(guessColumns(["Betrag", "Notiz"])).toBeNull()
  })
})

describe("applyColumnMap", () => {
  it("reads signed amounts and both dates", () => {
    const table = parseCsv(GERMAN)
    const map = guessColumns(table.headers)
    if (!map) throw new Error("expected a column map")

    const { lines, rejected } = applyColumnMap(table.rows, map)

    expect(rejected).toBe(0)
    expect(lines[0]).toEqual({
      bookedOn: "2025-01-02",
      spentOn: "2025-01-03",
      description: "REWE SAGT DANKE",
      counterparty: "REWE Markt GmbH",
      amountCents: -4520,
    })
    expect(lines[1]?.amountCents).toBe(325000)
    expect(lines[2]?.amountCents).toBe(-110000)
  })

  it("takes the sign from which of debit and credit is filled", () => {
    const table = parseCsv(ANGLO)
    const map = guessColumns(table.headers)
    if (!map) throw new Error("expected a column map")

    const { lines } = applyColumnMap(table.rows, map)

    expect(lines[0]?.amountCents).toBe(-320)
    expect(lines[0]?.description).toBe("Coffee, large")
    expect(lines[1]?.amountCents).toBe(325000)
  })

  it("counts unreadable rows instead of importing them as zero", () => {
    const table = parseCsv("Datum;Betrag;Verwendungszweck\nSaldo;;Zwischensumme\n02.01.2025;-1,00;X")
    const map = guessColumns(table.headers)
    if (!map) throw new Error("expected a column map")

    const { lines, rejected } = applyColumnMap(table.rows, map)

    expect(rejected).toBe(1)
    expect(lines).toHaveLength(1)
  })
})

describe("fingerprints", () => {
  it("gives two identical purchases on one day different keys", () => {
    const line = {
      bookedOn: "2025-01-02",
      spentOn: "2025-01-02",
      description: "Coffee",
      counterparty: null,
      amountCents: -320,
    }
    const refs = fingerprintAll("account", [line, line])

    expect(refs[0]).not.toBe(refs[1])
    // …and re-importing the same file reproduces both keys exactly, which is
    // what makes a second import a no-op rather than a doubling.
    expect(fingerprintAll("account", [line, line])).toEqual(refs)
  })

  it("keys on the account, so the same line in two accounts is two lines", () => {
    const line = {
      bookedOn: "2025-01-02",
      spentOn: "2025-01-02",
      description: "Transfer",
      counterparty: null,
      amountCents: -1000,
    }
    expect(fingerprint("a", line)).not.toBe(fingerprint("b", line))
  })
})
