import { color } from "@werft/tokens"
import type { Metadata, Viewport } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import { signOutAction } from "@/app/actions"
import { auth } from "@/auth"
import { Nav } from "@/components/nav"
// Tokens first: globals.css consumes the custom properties this defines.
import "@werft/tokens/tokens.css"
import "./globals.css"

export const metadata: Metadata = {
  title: "Kontoklar",
  description:
    "Your plan and your reality, reconciled — with an AI that tells you the truth about the gap.",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: color.bg.light },
    { media: "(prefers-color-scheme: dark)", color: color.bg.dark },
  ],
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The chrome only makes sense once there is a session; the login page is the
  // one route that renders without it.
  const session = await auth()

  return (
    <html lang="en">
      <body>
        {session?.user ? (
          <header className="topbar">
            <Link className="brand" href="/">
              Kontoklar
            </Link>
            <div className="nav">
              <Nav />
              <form action={signOutAction}>
                <button className="quiet" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </header>
        ) : null}
        {children}
      </body>
    </html>
  )
}
