import { expect, test } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const stamp = Date.now().toString(36);
const user = { name: "Kiran Rao", email: `kiran-${stamp}@example.test` };

test.describe.configure({ mode: "serial" });

test("landing page presents the product and its tracking box validates input", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Report problems\. Track progress\./ }),
  ).toBeVisible();
  await page.getByLabel("Tracking ID").fill("hello");
  await page.getByRole("button", { name: "Track" }).click();
  await expect(page.getByText(/A tracking ID looks like/)).toBeVisible();
  await page.getByLabel("Tracking ID").fill("cp-0000000000");
  await page.getByRole("button", { name: "Track" }).click();
  await expect(page).toHaveURL(/\/track\/CP-0000000000$/);
  await expect(page.getByRole("heading", { name: "No report with that ID" })).toBeVisible();
});

test("protected pages redirect to sign-in when signed out", async ({ page }) => {
  for (const path of ["/dashboard", "/complaints", "/report", "/members"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}$`));
  }
});

test("registration form explains what is wrong", async ({ page }) => {
  await page.goto("/register");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter your name")).toBeVisible();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Password must be at least 10 characters")).toBeVisible();
  await expect(page.getByText("Choose your community")).toBeVisible();
});

test("account: register, update profile, sign out, sign back in, delete", async ({ page }) => {
  await page.goto("/register?intent=organization");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/organizations\/new$/);

  await page.goto("/settings");
  await page.getByLabel("Full name").fill("Kiran R. Rao");
  await page.getByLabel("Phone (optional)").fill("+91 98765 43210");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Kiran R. Rao");
  await expect(page.getByText("This device")).toBeVisible();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/settings");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password")).toBeVisible();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.getByRole("button", { name: "Delete my account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await dialog.getByLabel("Password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/$/);
});
