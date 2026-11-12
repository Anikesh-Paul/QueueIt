import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

test("a served student rates the visit from the queues page", async ({ page, request }) => {
  const { admin } = tokens();
  const headers = { Authorization: `Bearer ${admin}` };
  const gym = await queueByName(request, "Gym");
  await ensureOpen(request, admin, gym.id);
  const student = await registerStudent(request, "feedback");
  const join = await request.post(`${API}/api/queues/${gym.id}/join`, { headers: { Authorization: `Bearer ${student}` } });
  expect(join.status()).toBe(201);
  const { tokenNumber } = await join.json();
  const list = await (await request.get(`${API}/api/admin/queues/${gym.id}/waiting-list`, { headers })).json();
  const row = list.waiting.find((w) => w.tokenNumber === tokenNumber);
  const serve = await request.post(`${API}/api/admin/queues/${gym.id}/serve`, { headers, data: { entryId: row.id } });
  expect(serve.status()).toBe(200);

  await signIn(page, student);
  await page.goto("/queues");
  const prompt = page.getByTestId("feedback-prompt");
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await expect(prompt).toContainText("How was Gym?");
  await page.getByTestId("feedback-star-5").click();
  await page.getByTestId("feedback-prompt-form-comment").fill("Smooth visit");
  await page.getByTestId("feedback-prompt-form-send").click();
  await expect(page.getByTestId("feedback-prompt-form-thanks")).toBeVisible();

  await page.goto("/history");
  await expect(page.getByTestId("history-rated").first()).toBeVisible();
});
