/**
 * Where the user lives, expressed as the three things it actually changes:
 * how money is written, how dates are written, and what the model should be
 * told about local tax before it offers an opinion.
 *
 * The presets are a convenience, not a taxonomy — anything not listed is
 * entered by hand, because a personal finance app that only works in the
 * countries someone bothered to enumerate is not a product.
 *
 * Note what is deliberately absent: any encoded tax *rule*. Deductibility
 * changes yearly and differs by circumstance, and hard-coding "commuting is
 * deductible" would be wrong somewhere and stale everywhere. The country only
 * tells the model which system to reason about, and every answer it gives is
 * labelled as information rather than advice.
 */

export type Preset = {
  country: string
  label: string
  currency: string
  locale: string
  taxContext: string
}

export const PRESETS: readonly Preset[] = [
  {
    country: "DE",
    label: "Germany",
    currency: "EUR",
    locale: "de-DE",
    taxContext:
      "German income tax (Einkommensteuer), with Werbungskosten, Sonderausgaben and haushaltsnahe Dienstleistungen as the usual deduction categories.",
  },
  {
    country: "AT",
    label: "Austria",
    currency: "EUR",
    locale: "de-AT",
    taxContext: "Austrian income tax, with Werbungskosten and Sonderausgaben as usual deductions.",
  },
  {
    country: "CH",
    label: "Switzerland",
    currency: "CHF",
    locale: "de-CH",
    taxContext:
      "Swiss federal and cantonal income tax; deductions vary substantially by canton, so say so.",
  },
  {
    country: "NL",
    label: "Netherlands",
    currency: "EUR",
    locale: "nl-NL",
    taxContext: "Dutch income tax with its box system and the usual aftrekposten.",
  },
  {
    country: "GB",
    label: "United Kingdom",
    currency: "GBP",
    locale: "en-GB",
    taxContext:
      "UK income tax and National Insurance; most employees cannot deduct ordinary expenses, so be careful before implying they can.",
  },
  {
    country: "US",
    label: "United States",
    currency: "USD",
    locale: "en-US",
    taxContext:
      "US federal income tax; the standard deduction means itemising rarely helps, and state tax varies.",
  },
  {
    country: "IN",
    label: "India",
    currency: "INR",
    locale: "en-IN",
    taxContext:
      "Indian income tax with its old and new regimes; deductions under 80C and similar apply only under the old regime.",
  },
  {
    country: "CA",
    label: "Canada",
    currency: "CAD",
    locale: "en-CA",
    taxContext: "Canadian federal and provincial income tax, with RRSP and TFSA as the usual shelters.",
  },
] as const

export type Settings = {
  country: string
  currency: string
  locale: string
  /** What to call the money as a whole — "our money", "my budget". Cosmetic,
   * and the only concession to household shape anywhere in the model. */
  householdName: string
}

export const DEFAULT_SETTINGS: Settings = {
  country: "DE",
  currency: "EUR",
  locale: "de-DE",
  householdName: "My money",
}

export function presetFor(country: string): Preset | undefined {
  return PRESETS.find((preset) => preset.country === country)
}

export function taxContextFor(country: string): string {
  return (
    presetFor(country)?.taxContext ??
    `the tax system of ${country}, which you should reason about only in general terms and flag as uncertain`
  )
}
