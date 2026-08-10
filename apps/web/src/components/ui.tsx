import type { ReactNode } from "react"
import { formatMoney, formatMoneyShort, type Month } from "@/domain/money"

/**
 * The small vocabulary every screen is built from.
 *
 * Server components without exception — none of these need state, and a
 * dashboard that renders on the server is a dashboard that renders before the
 * first byte of JavaScript arrives. The charts are hand-drawn SVG for the same
 * reason a charting library is not in the blessed dependency list: three chart
 * shapes are less code than the adapter around a library that draws thirty.
 */

export function Money({
  cents,
  currency,
  locale,
  signed = false,
  short = false,
}: {
  cents: number
  currency: string
  locale: string
  /** Colour by sign. Off by default: most amounts on a spending screen are
   * negative and a wall of red says nothing. */
  signed?: boolean
  short?: boolean
}) {
  const text = short ? formatMoneyShort(cents, currency, locale) : formatMoney(cents, currency, locale)
  const tone = !signed ? "" : cents < 0 ? " neg" : cents > 0 ? " pos" : ""
  return <span className={`num${tone}`}>{text}</span>
}

export function Tile({
  label,
  value,
  note,
}: {
  label: string
  value: ReactNode
  note?: ReactNode
}) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note ? <div className="tile-note">{note}</div> : null}
    </div>
  )
}

export function Bar({ ratio }: { ratio: number | null }) {
  if (ratio === null) return null
  const width = Math.max(0, Math.min(1, ratio)) * 100
  const tone = ratio > 1 ? " over" : ratio > 0.9 ? "" : " good"
  return (
    <div className="bar">
      {/* A percentage of the parent is a layout value, not a design token. */}
      <span className={`bar-fill${tone}`} style={{ width: `${width}%` }} />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="notice">{children}</p>
}

/**
 * A line over months. Flat data, flat drawing: no axes beyond a baseline,
 * because a sparkline that needs a legend has stopped being a sparkline.
 */
export function Sparkline({
  points,
  height = 48,
}: {
  points: readonly { month: Month; value: number }[]
  height?: number
}) {
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length < 2 || !first || !last) return null

  const values = points.map((point) => point.value)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || 1
  const step = 100 / (points.length - 1)

  const coordinates = points.map((point, index) => {
    const x = index * step
    const y = height - ((point.value - min) / span) * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const zeroY = height - ((0 - min) / span) * height

  return (
    <svg
      className="chart"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${first.month} to ${last.month}`}
      style={{ height: `${height}px` }}
    >
      <title>
        {first.month} to {last.month}
      </title>
      <polygon className="area" points={`0,${zeroY} ${coordinates.join(" ")} 100,${zeroY}`} />
      <line className="axis" x1="0" y1={zeroY} x2="100" y2={zeroY} />
      <polyline className="line" points={coordinates.join(" ")} />
    </svg>
  )
}

/**
 * Where money goes between the user's own accounts, drawn from the transfers
 * reconciliation already found. Payers on the left, receivers on the right,
 * thickness by volume — an account that is both appears in both columns, which
 * is less elegant than a proper graph layout and far easier to read.
 */
export function FlowDiagram({
  edges,
  names,
  currency,
  locale,
}: {
  edges: readonly { fromId: string; toId: string; amountCents: number; count: number }[]
  names: ReadonlyMap<string, string>
  currency: string
  locale: string
}) {
  if (edges.length === 0) return null

  const sources = [...new Set(edges.map((edge) => edge.fromId))]
  const targets = [...new Set(edges.map((edge) => edge.toId))]
  const rows = Math.max(sources.length, targets.length)
  const rowHeight = 44
  const height = rows * rowHeight + 20
  const heaviest = Math.max(...edges.map((edge) => edge.amountCents), 1)

  const y = (index: number, count: number) => (height / (count + 1)) * (index + 1)

  return (
    <svg
      className="chart"
      viewBox={`0 0 600 ${height}`}
      role="img"
      aria-label="Money flow between accounts"
      style={{ maxHeight: `${height}px` }}
    >
      <title>Money flow between accounts</title>
      {edges.map((edge) => {
        const fromY = y(sources.indexOf(edge.fromId), sources.length)
        const toY = y(targets.indexOf(edge.toId), targets.length)
        const width = 1 + (edge.amountCents / heaviest) * 8
        return (
          <path
            key={`${edge.fromId}-${edge.toId}`}
            className="edge"
            strokeWidth={width}
            d={`M 170 ${fromY} C 300 ${fromY}, 300 ${toY}, 430 ${toY}`}
          />
        )
      })}
      {sources.map((id, index) => (
        <text key={id} x="160" y={y(index, sources.length) + 4} textAnchor="end">
          {names.get(id) ?? "Unknown"}
        </text>
      ))}
      {targets.map((id, index) => (
        <text key={id} x="440" y={y(index, targets.length) + 4}>
          {names.get(id) ?? "Unknown"}
        </text>
      ))}
      {edges.map((edge) => {
        const fromY = y(sources.indexOf(edge.fromId), sources.length)
        const toY = y(targets.indexOf(edge.toId), targets.length)
        return (
          <text
            key={`label-${edge.fromId}-${edge.toId}`}
            className="label"
            x="300"
            y={(fromY + toY) / 2 - 6}
            textAnchor="middle"
          >
            {formatMoneyShort(edge.amountCents, currency, locale)}
          </text>
        )
      })}
    </svg>
  )
}
