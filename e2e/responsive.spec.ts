import { expect, test } from "@playwright/test";

const stamp = Date.now().toString(36);

test("mobile: menu navigation works and no page overflows sideways", async ({ page }) => {
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  await page.goto("/");
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.goto("/register?intent=organization");
  await page.getByLabel("Full name").fill("Mobile Tester");
  await page.getByLabel("Email").fill(`mobile-${stamp}@example.test`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/organizations\/new$/);
  await page.getByLabel("Name", { exact: true }).fill(`Mobile Society ${stamp}`);
  await expect(page.getByLabel("Address")).toHaveValue(`mobile-society-${stamp}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  const destinations = [
    ["Report an issue", "/report"],
    ["Reports", "/complaints"],
    ["People", "/members"],
    ["Settings", "/settings"],
  ] as const;
  for (const [destination, path] of destinations) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("dialog", { name: "Menu" })
      .getByRole("link", { name: destination, exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Measure after the page's data has rendered, not while skeletons are showing.
    await expect(page.locator(".animate-pulse")).toHaveCount(0);
    expect(await overflow(), `${destination} overflows`).toBeLessThanOrEqual(0);
  }
});
