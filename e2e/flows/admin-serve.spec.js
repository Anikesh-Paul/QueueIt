import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

test("admin calls and serves the next person from the console", async ({ page, request }) => {
  const { admin } = tokens();
  const cafeteria = await queueByName(request, "Cafeteria");
  await ensureOpen(request, admin, cafeteria.id);
  const student = await registerStudent(request, "serve");
  const join = await request.post(`${API}/api/queues/${cafeteria.id}/join`, { headers: { Authorization: `Bearer ${student}` } });
  expect(join.status()).toBe(201);
  const { tokenNumber } = await join.json();

  await signIn(page, admin);
  await page.goto(`/admin/queues/${cafeteria.id}`);
  await expect(page.getByTestId("admin-waiting-list")).toBeVisible({ timeout: 15_000 });

  // Clear anyone ahead so our student is next (other specs may leave people waiting).
  for (let i = 0; i < 20; i += 1) {
    const list = await request.get(`${API}/api/admin/queues/${cafeteria.id}/waiting-list`, { headers: { Authorization: `Bearer ${admin}` } });
    const body = await list.json();
    const first = (body.waiting || [])[0];
    if (!first || first.tokenNumber === tokenNumber) break;
    await request.post(`${API}/api/admin/queues/${cafeteria.id}/skip`, { headers: { Authorization: `Bearer ${admin}` }, data: { entryId: first.id } });
  }
  await page.reload();

  await page.getByTestId("admin-call").click();
  await expect(page.getByTestId("admin-now-serving").first()).toContainText(String(tokenNumber), { timeout: 10_000 });
  await page.getByTestId("admin-serve").click();

  await expect
    .poll(async () => {
      const res = await request.get(`${API}/api/queues/${cafeteria.id}/status`, { headers: { Authorization: `Bearer ${student}` } });
      return res.status() === 200 ? (await res.json()).status : res.status();
    }, { timeout: 10_000 })
    .not.toBe("serving");
});
