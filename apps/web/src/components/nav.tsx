"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

/**
 * The only client component in the app.
 *
 * It exists solely to mark the current link, which needs the pathname, which a
 * server component cannot see. Everything else renders on the server.
 */

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/import", label: "Import" },
  { href: "/budget", label: "Budget" },
  { href: "/accounts", label: "Accounts" },
  { href: "/advisor", label: "Advisor" },
  { href: "/meeting", label: "Money meeting" },
  { href: "/settings", label: "Settings" },
] as const

export function Nav() {
  const pathname = usePathname()

  return (
    <>
      {LINKS.map((link) => {
        const current = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href)
        return (
          <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}>
            {link.label}
          </Link>
        )
      })}
    </>
  )
}
