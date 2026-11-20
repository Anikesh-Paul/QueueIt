import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

test("Group tickets: join as a group, shrink it, staff see the badge", async ({ page, browser, request }) => {
  const { admin } = tokens();
  const gym = await queueByName(request, "Gym");
  await ensureOpen(request, admin, gym.id);
  expect(gym.groups).toEqual({ enabled: true, maxSize: 4, extraPerPerson: 0.5 });
  const student = await registerStudent(request, "group");
  const headers = { Authorization: `Bearer ${student}` };

  // The API refuses sizes past the queue maximum.
  const tooBig = await request.post(`${API}/api/queues/${gym.id}/join`, { headers, data: { partySize: 6 } });
  expect(tooBig.status()).toBe(400);

  await signIn(page, student);
  await page.goto(`/join/${gym.id}`);
  const picker = page.getByTestId("party-size-picker");
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await expect(picker.getByRole("radio")).toHaveCount(4);
  await expect(page.getByTestId("party-size-option-1")).toBeChecked();
  await picker.getByText("3 people").click();
  await expect(page.getByTestId("party-size-option-3")).toBeChecked();
  await page.getByTestId("join-queue").click();
  await expect(page).toHaveURL(/\/status/);

  const party = page.getByTestId("status-party");
  await expect(party).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("status-party-size")).toHaveText("Group of 3");
  const status = await (await request.get(`${API}/api/queues/${gym.id}/status`, { headers })).json();
  expect(status.partySize).toBe(3);
  const token = status.tokenNumber;

  // Staff see the group on the waiting list.
  const staff = await browser.newPage();
  await signIn(staff, admin);
  await staff.goto(`/admin/queues/${gym.id}`);
  const row = staff.locator(`[data-testid="waiting-entry"][data-token="${token}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByTestId("waiting-party-badge")).toHaveText(/Group of 3/);

  // Shrink to 2 (can't grow back).
  await page.getByTestId("party-reduce-select").selectOption("2");
  await page.getByTestId("party-reduce-submit").click();
  await expect(page.getByTestId("status-party-size")).toHaveText("Group of 2");
  await expect(page.getByTestId("party-reduce-select").locator("option")).toHaveCount(1);
  const grow = await request.post(`${API}/api/queues/${gym.id}/party-size`, { headers, data: { partySize: 3 } });
  expect(grow.status()).toBe(400);
  await staff.reload();
  await expect(staff.locator(`[data-testid="waiting-entry"][data-token="${token}"]`).getByTestId("waiting-party-badge")).toHaveText(/Group of 2/, { timeout: 15_000 });
  await staff.close();

  // Leave so the shared Gym line is back to how other specs expect it.
  expect((await request.post(`${API}/api/queues/${gym.id}/leave`, { headers })).status()).toBe(200);
});
