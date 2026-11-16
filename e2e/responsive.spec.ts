import { expect, test } from "@playwright/test";

const stamp = Date.now().toString(36);

test("mobile: navigation works through the menu and nothing overflows", async ({ page }) => {
  await page.goto("/");
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.goto("/register?intent=organization");
  await page.getByLabel("Full name").fill("Mobile Tester");
  await page.getByLabel("Email").fill(`mobile-${stamp}@example.test`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/organizations\/new$/);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);
});
