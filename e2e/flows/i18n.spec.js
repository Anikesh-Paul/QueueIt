import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

test("language switcher: Bengali sticks after a reload and sets <html lang>", async ({ page, request }) => {
  const student = await registerStudent(request, "i18n");
  await signIn(page, student);
  await page.goto("/queues");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Queues");

  const select = page.getByTestId("language-select");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveText(["English", "हिन्दी", "বাংলা"]);
  await select.selectOption("bn");
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("লাইন");
  await expect(page.getByTestId("shell-logout")).toHaveText("লগ আউট");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page.getByTestId("language-select")).toHaveValue("bn");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("লাইন");

  await page.getByTestId("language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Queues");
});

test.describe("first visit follows the browser language", () => {
  test.use({ locale: "hi-IN" });
  test("a Hindi browser gets Hindi with no saved choice", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByTestId("language-select")).toHaveValue("hi");
    await expect(page.getByLabel("ईमेल")).toBeVisible();
    await expect(page.getByLabel("पासवर्ड")).toBeVisible();
  });
});

test.describe("Bengali browser", () => {
  test.use({ locale: "bn-IN" });
  test("the kiosk board and join page read in Bengali", async ({ page, request }) => {
    const { admin } = tokens();
    const cafeteria = await queueByName(request, "Cafeteria");
    await ensureOpen(request, admin, cafeteria.id);
    await page.goto(`/kiosk/${cafeteria.id}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
    await expect(page.getByText("যোগ দিতে স্ক্যান করুন")).toBeVisible();
    await expect(page.getByText("শুধু টোকেন নম্বর দেখানো হয়।", { exact: false })).toBeVisible();

    await page.goto(`/join/${cafeteria.id}?src=qr`);
    await expect(page.getByText("আপনি এই লাইনের পোস্টার স্ক্যান করেছেন")).toBeVisible();
  });
});

test("staff views: nav, live view and poster in Hindi", async ({ page, request }) => {
  const { admin } = tokens();
  const cafeteria = await queueByName(request, "Cafeteria");
  const res = await request.get(`${API}/api/admin/live`, { headers: { Authorization: `Bearer ${admin}` } });
  expect(res.status()).toBe(200);
  await signIn(page, admin, { locale: "hi" });
  await page.goto("/admin/catalog");
  await expect(page.getByTestId("nav-live").first()).toHaveText("लाइव");
  await page.goto("/admin/live");
  await expect(page.getByTestId("live-heading")).toHaveText("लाइव व्यू");
  await expect(page.getByTestId("live-updated")).toContainText("अपडेट");
  await page.goto(`/admin/queues/${cafeteria.id}/poster`);
  await expect(page.getByText("लाइन में खड़े न रहें। फ़ोन से शामिल हों।")).toBeVisible();
  await expect(page.getByRole("button", { name: "पोस्टर प्रिंट करें" })).toBeVisible();
});
