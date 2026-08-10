import { expect, test } from "@playwright/test"

test("an unauthenticated visitor is sent to the login page", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
  await expect(page.getByLabel("Email")).toBeVisible()
  await expect(page.getByLabel("Password")).toBeVisible()

  // The gate has to actually withhold the page, not merely change the URL.
  await expect(page.getByText("Replace this page")).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Transactions" })).toHaveCount(0)
})

test("every app route is closed, not just the home page", async ({ page }) => {
  // Closed by default is the whole claim; a route added without a thought
  // should still be private, and this is what proves it stays that way.
  for (const route of ["/transactions", "/budget", "/import", "/advisor", "/settings", "/api/export"]) {
    await page.goto(route)
    await expect(page, route).toHaveURL(/\/login/)
  }
})

test("the login page is styled by the token stylesheet", async ({ page }) => {
  await page.goto("/login")

  // Proves the generated CSS was built and served — a missing dist/tokens.css
  // leaves this custom property undefined.
  const background = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  )

  expect(background).not.toBe("")
})
