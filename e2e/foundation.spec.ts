import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const stamp = Date.now().toString(36);
const admin = { name: "Asha Verma", email: `asha-${stamp}@example.test` };
const citizen = { name: "Priya Nair", email: `priya-${stamp}@example.test` };
const organization = { name: `Greenfield College ${stamp}`, slug: `greenfield-college-${stamp}` };

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe.configure({ mode: "serial" });

test("landing page presents the product and links to registration", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Report problems\. Track progress\./ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/register$/);
});

test("protected pages redirect to sign-in when signed out", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});

test("registration form explains what is wrong", async ({ page }) => {
  await page.goto("/register");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter your name")).toBeVisible();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Password must be at least 10 characters")).toBeVisible();
  await expect(page.getByText("Choose your community")).toBeVisible();
});

test("an administrator registers and creates an organization", async ({ page }) => {
  await page.goto("/register?intent=organization");
  await page.getByLabel("Full name").fill(admin.name);
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await expect(page.getByLabel("Your community")).toHaveValue("__own__");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/organizations\/new$/);
  await page.getByLabel("Name").fill(organization.name);
  // The address is derived from the name until the user edits it.
  await expect(page.getByLabel("Address")).toHaveValue(organization.slug);
  await page.getByLabel("Type").selectOption("COLLEGE");
  await page.getByRole("button", { name: "Create organization" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Asha" })).toBeVisible();
  await expect(page.getByRole("heading", { name: organization.name })).toBeVisible();
  await expect(page.getByText("Signed in as organization admin.")).toBeVisible();
  // The members table is real data: exactly the creator so far.
  await expect(page.getByText("1 in this organization")).toBeVisible();
  await expect(page.getByRole("cell", { name: new RegExp(admin.email) })).toBeVisible();
  await signOut(page);
});

test("a citizen joins the organization and sees a citizen view", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(citizen.name);
  await page.getByLabel("Email").fill(citizen.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Your community").selectOption(organization.slug);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Signed in as citizen.")).toBeVisible();
  await expect(page.getByRole("heading", { name: organization.name })).toBeVisible();
  // Citizens have no member:read permission, so the members card is absent.
  await expect(page.getByRole("heading", { name: "Members" })).toHaveCount(0);
  await signOut(page);
});

test("duplicate registration is reported on the email field", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Someone Else");
  await page.getByLabel("Email").fill(citizen.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Your community").selectOption(organization.slug);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("An account with this email already exists")).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});

test("sign-in rejects bad credentials, then works and returns to the requested page", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password")).toBeVisible();

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  // The administrator now sees both members.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Overview" })
    .click();
  await expect(page.getByText("2 in this organization")).toBeVisible();
});

test("settings: profile update persists and devices are listed", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(citizen.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings");
  await page.getByLabel("Full name").fill("Priya N. Nair");
  await page.getByLabel("Phone (optional)").fill("+91 98765 43210");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Priya N. Nair");
  await expect(page.getByLabel("Phone (optional)")).toHaveValue("+91 98765 43210");
  await expect(page.getByText("This device")).toBeVisible();
});

test("account deletion requires the password and signs the user out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(citizen.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await dialog.getByLabel("Password").fill("wrong-password");
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(dialog.getByText("Password is incorrect")).toBeVisible();

  await dialog.getByLabel("Password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/login");
  await page.getByLabel("Email").fill(citizen.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password")).toBeVisible();
});
