import { inflateSync } from "node:zlib"

/**
 * Pull the visible text out of a PDF statement, with no dependency.
 *
 * A PDF is a container of streams; the ones that draw text are usually
 * Flate-compressed and contain `Tj`/`TJ` operators whose operands are the
 * strings on the page. Inflating those and concatenating the operands gives
 * back something close to the statement's text — good enough to hand to a
 * model, which is the only consumer.
 *
 * Deliberately not a PDF renderer. It does not do encrypted files, cross
 * reference streams that hide the page content, or scanned images with no text
 * layer at all. Those cases return little or nothing and the import screen
 * says so rather than pretending, because a PDF library is a dependency
 * decision for a human and OCR is a different product.
 */
export function extractPdfText(bytes: Uint8Array): string {
  const chunks: string[] = []

  for (const stream of streams(bytes)) {
    const text = readTextOperators(stream)
    if (text.trim() !== "") chunks.push(text)
  }

  return chunks
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Every `stream ... endstream` body, inflated when it inflates. */
function* streams(bytes: Uint8Array): Generator<string> {
  const latin1 = Buffer.from(bytes).toString("latin1")
  const opener = /stream\r?\n?/g
  let match: RegExpExecArray | null

  while ((match = opener.exec(latin1)) !== null) {
    const start = match.index + match[0].length
    const end = latin1.indexOf("endstream", start)
    if (end < 0) break
    opener.lastIndex = end

    const slice = Buffer.from(latin1.slice(start, end), "latin1")
    try {
      yield inflateSync(slice).toString("latin1")
    } catch {
      // Uncompressed content streams exist too; only worth reading if they
      // look like text operators rather than an embedded font or image.
      const raw = slice.toString("latin1")
      if (/\(([^)]*)\)\s*Tj/.test(raw) || /\bTJ\b/.test(raw)) yield raw
    }
  }
}

/**
 * Read the string operands of the text-showing operators.
 *
 * `TD`/`Td`/`T*` move the cursor to a new line, so they become newlines —
 * without that the whole statement arrives as one paragraph and no model can
 * tell where a row ends.
 */
function readTextOperators(content: string): string {
  let out = ""
  const token = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\bT[Jjd*D]\b|\bET\b/g
  let match: RegExpExecArray | null
  let pending = ""

  while ((match = token.exec(content)) !== null) {
    const value = match[0]
    if (value.startsWith("(")) {
      pending += unescapePdfString(value.slice(1, -1))
    } else if (value.startsWith("<")) {
      pending += fromHex(value.slice(1, -1))
    } else if (value === "Tj" || value === "TJ") {
      out += pending
      pending = ""
    } else {
      out += `${pending}\n`
      pending = ""
    }
  }

  return out + pending
}

function unescapePdfString(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, escape: string) => {
    switch (escape) {
      case "n":
        return "\n"
      case "r":
        return "\r"
      case "t":
        return "\t"
      case "b":
      case "f":
        return " "
      case "(":
        return "("
      case ")":
        return ")"
      case "\\":
        return "\\"
      default:
        return String.fromCharCode(Number.parseInt(escape, 8))
    }
  })
}

function fromHex(value: string): string {
  const digits = value.replace(/\s+/g, "")
  let out = ""
  // Hex strings in text operators are usually UTF-16BE, so pairs of bytes.
  for (let i = 0; i + 3 < digits.length; i += 4) {
    const code = Number.parseInt(digits.slice(i, i + 4), 16)
    if (Number.isFinite(code) && code > 31) out += String.fromCharCode(code)
  }
  return out
}
