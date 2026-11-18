import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The acceptance scenario, driven through the UI by four different people:
 * an administrator, a field worker, a citizen, and an anonymous member of the public.
 */
const PASSWORD = "correct-horse-battery";
const stamp = Date.now().toString(36);
const organization = { name: `Lakeview Campus ${stamp}`, slug: `lakeview-campus-${stamp}` };
const admin = { name: "Asha Verma", email: `asha-${stamp}@example.test` };
const worker = { name: "Imran Sheikh", email: `imran-${stamp}@example.test` };
const citizen = { name: "Priya Nair", email: `priya-${stamp}@example.test` };
const title = `Streetlight out near the library gate ${stamp}`;

// 1×1 PNG; enough for the server to decode and re-encode.
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let adminPage: Page;
let workerPage: Page;
let citizenPage: Page;
let trackingId = "";

async function register(
  page: Page,
  person: { name: string; email: string },
  community: string | null,
) {
  await page.goto(community ? "/register" : "/register?intent=organization");
  await page.getByLabel("Full name").fill(person.name);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  if (community) await page.getByLabel("Your community").selectOption(community);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(community ? /\/dashboard$/ : /\/organizations\/new$/);
}

/** Notifications arrive asynchronously (outbox relay); reload until the entry shows up. */
async function openNotification(page: Page, name: RegExp) {
  await nav(page, "Notifications");
  await expect(page).toHaveURL(/\/notifications$/);
  const entry = page.getByRole("button", { name });
  await expect(async () => {
    if (!(await entry.isVisible())) await page.reload();
    await expect(entry).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await entry.click();
}

const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main" })
    // The Notifications link also announces its unread count.
    .getByRole("link", { name: new RegExp(`^${name}( \\d+\\+? unread)?$`) })
    .click();

test.describe.configure({ mode: "serial" });
// Contexts opened inside a test are closed when it ends; these must outlive single tests.
test.beforeAll(async ({ browser }: { browser: Browser }) => {
  [adminPage, workerPage, citizenPage] = await Promise.all(
    [0, 1, 2].map(async () => (await browser.newContext()).newPage()),
  );
});
test.afterAll(async () => {
  await Promise.all([adminPage, workerPage, citizenPage].map((page) => page?.context().close()));
});

test("administrator sets up the organization, a department and a field worker", async () => {
  await register(adminPage, admin, null);
  await adminPage.getByLabel("Name").fill(organization.name);
  await expect(adminPage.getByLabel("Address")).toHaveValue(organization.slug);
  await adminPage.getByRole("button", { name: "Create organization" }).click();
  await expect(adminPage.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  // Real figures: a new organization has nothing, and says so.
  await expect(adminPage.getByRole("heading", { name: "No reports yet" })).toBeVisible();

  await nav(adminPage, "Departments");
  await adminPage.getByRole("button", { name: "New department" }).first().click();
  await adminPage.getByLabel("Name").fill("Electrical maintenance");
  await adminPage.getByRole("button", { name: "Create", exact: true }).click();
  await expect(adminPage.getByText("Department created")).toBeVisible();

  await register(workerPage, worker, organization.slug);
  await nav(adminPage, "People");
  await adminPage.getByRole("button", { name: `Edit ${worker.name}` }).click();
  await adminPage.getByLabel("Role").selectOption("FIELD_WORKER");
  await adminPage.getByLabel("Department").selectOption({ label: "Electrical maintenance" });
  await adminPage.getByRole("button", { name: "Save" }).click();
  await expect(adminPage.getByText(`${worker.name} updated`)).toBeVisible();
});

test("citizen reports an issue with a photo and receives a tracking ID", async () => {
  await register(citizenPage, citizen, organization.slug);
  await expect(
    citizenPage.getByRole("heading", { name: "You have not reported anything yet" }),
  ).toBeVisible();
  await citizenPage.getByRole("link", { name: "Report an issue" }).first().click();

  await citizenPage.getByRole("button", { name: "Submit report" }).click();
  await expect(citizenPage.getByText("Choose what kind of problem this is")).toBeVisible();

  await citizenPage.getByText("Streetlights", { exact: true }).click();
  await citizenPage.getByLabel("Short title").fill(title);
  await citizenPage
    .getByLabel("Details")
    .fill("The lamp has been dark for a week and the path is unsafe at night.");
  await citizenPage.getByLabel("Location in words").fill("Library gate, east side");
  await citizenPage
    .getByLabel("Add photo")
    .setInputFiles({ name: "lamp.png", mimeType: "image/png", buffer: PHOTO });
  await expect(citizenPage.getByAltText("Photo 1: lamp.png")).toBeVisible();
  await citizenPage.getByRole("button", { name: "Submit report" }).click();

  await expect(citizenPage.getByRole("heading", { name: "Report received" })).toBeVisible();
  trackingId = (await citizenPage.getByText(/^CP-[0-9A-Z]{10}$/).textContent())!;
  await citizenPage.getByRole("link", { name: "Open the report" }).click();
  await expect(citizenPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(citizenPage.getByAltText("Report photo")).toBeVisible();
  // A citizen has no workflow buttons on a fresh report.
  await expect(citizenPage.getByRole("button", { name: "Verify" })).toHaveCount(0);
});

test("administrator verifies and assigns the report", async () => {
  await openNotification(adminPage, /New report to review/);
  await expect(adminPage.getByRole("heading", { level: 1, name: title })).toBeVisible();

  await adminPage.getByRole("button", { name: "Verify" }).click();
  await expect(adminPage.getByText("Verify: done")).toBeVisible();
  await expect(adminPage.getByText(/Due in \d+ days/)).toBeVisible();

  await adminPage.getByRole("button", { name: "Assign", exact: true }).click();
  const dialog = adminPage.getByRole("dialog", { name: "Assign this report" });
  await dialog.getByLabel("Department").selectOption({ index: 1 });
  await dialog.getByLabel("Field worker (optional)").selectOption({ index: 1 });
  await dialog.getByLabel("Instructions (optional)").fill("Check the fuse box first");
  await dialog.getByRole("button", { name: "Assign" }).click();
  await expect(adminPage.getByText("Report assigned")).toBeVisible();
  await expect(adminPage.getByText("awaiting acceptance")).toBeVisible();
});

test("field worker accepts, works on and resolves the report", async () => {
  await workerPage.reload();
  await expect(workerPage.getByRole("heading", { name: `Your work, Imran` })).toBeVisible();
  await workerPage.getByRole("link", { name: new RegExp(title) }).click();
  await expect(workerPage.getByText("Check the fuse box first")).toBeVisible();

  await workerPage.getByRole("button", { name: "Accept assignment" }).click();
  await expect(workerPage.getByText("Assignment accepted")).toBeVisible();
  await workerPage.getByRole("button", { name: "Start work" }).click();
  await expect(workerPage.getByText("Start work: done")).toBeVisible();

  await workerPage.getByRole("button", { name: "Mark resolved" }).click();
  const dialog = workerPage.getByRole("dialog", { name: "Mark resolved?" });
  await expect(dialog.getByRole("button", { name: "Mark resolved" })).toBeDisabled();
  await dialog.getByLabel("Note").fill("Replaced the lamp and the blown fuse.");
  await dialog.getByRole("button", { name: "Mark resolved" }).click();
  await expect(workerPage.getByText("Mark resolved: done")).toBeVisible();
});

test("citizen is notified, sees the history, confirms and rates", async () => {
  await openNotification(citizenPage, /Marked as resolved/);

  await expect(citizenPage.getByText("Replaced the lamp and the blown fuse.")).toBeVisible();
  // Staff instructions are not shown to the reporter.
  await expect(citizenPage.getByText("Check the fuse box first")).toHaveCount(0);

  const confirm = citizenPage.getByRole("button", { name: "Confirm and close" });
  if (!(await confirm.isVisible({ timeout: 10_000 }).catch(() => false))) {
    // Record what the page showed, so a failure here is diagnosable rather than a bare timeout.
    console.log(
      "confirm button missing; page text:\n" +
        (await citizenPage.locator("main").innerText()).slice(0, 1500),
    );
    await citizenPage.reload();
  }
  await confirm.click();
  await expect(citizenPage.getByText("Confirm and close: done")).toBeVisible();
  await citizenPage.getByText("5 stars").click({ force: true });
  await citizenPage.getByRole("button", { name: "Send rating" }).click();
  await expect(citizenPage.getByRole("heading", { name: "Your rating" })).toBeVisible();
});

test("anyone can follow the report by tracking ID without seeing who reported it", async ({
  page,
}) => {
  await page.goto("/track");
  await page.getByLabel("Tracking ID").fill(trackingId.toLowerCase());
  await page.getByRole("button", { name: "Track" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  for (const step of ["Reported", "Verified", "Assigned", "In progress", "Resolved", "Closed"]) {
    await expect(page.getByRole("listitem").filter({ hasText: step }).first()).toBeVisible();
  }
  await expect(page.getByText("Electrical maintenance")).toBeVisible();
  const text = await page.locator("body").innerText();
  for (const secret of [citizen.name, citizen.email, worker.name, admin.name, "fuse box first"]) {
    expect(text).not.toContain(secret);
  }
});

test("administrator dashboard and audit log reflect what happened", async () => {
  await nav(adminPage, "Overview");
  const figures = adminPage.getByRole("region", { name: "Key figures" });
  await expect(figures.getByText("Resolved", { exact: true }).locator("..")).toContainText("1");
  await expect(figures.getByText("Resolution rate").locator("..")).toContainText("100%");
  await expect(figures.getByText(/Rated 5\.0\/5 by 1/)).toBeVisible();

  await nav(adminPage, "Audit log");
  await expect(
    adminPage.getByText(new RegExp(`moved report ${trackingId} from in progress to resolved`)),
  ).toBeVisible();
  await expect(adminPage.getByText("created department “Electrical maintenance”")).toBeVisible();
});

test("administrator finds the report with search, matches highlighted", async () => {
  await nav(adminPage, "Search");
  await adminPage.getByLabel("Search reports").fill("streetlight");
  const hit = adminPage.getByRole("link", { name: new RegExp(title) });
  await expect(hit).toBeVisible();
  await expect(hit.locator("mark").first()).toBeVisible();
  // Filters narrow the result; a word that is not there finds nothing.
  await adminPage.getByLabel("Search reports").fill("zebra crossing paint");
  await expect(adminPage.getByRole("heading", { name: "No reports match" })).toBeVisible();
});
