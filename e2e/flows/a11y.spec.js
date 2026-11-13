import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { queueByName, signIn, tokens } from "./helpers.js";

/** Pages that matter most, checked against WCAG 2.1 A/AA in both themes. */
async function pages(request) {
  const cafeteria = await queueByName(request, "Cafeteria");
  const { admin, student } = tokens();
  return [
    ["login", "/login", null],
    ["queues", "/queues", student],
    ["join (QR)", `/join/${cafeteria.id}?src=qr`, null],
    ["history", "/history", student],
    ["book a time", `/book/${cafeteria.id}`, student],
    ["kiosk", `/kiosk/${cafeteria.id}`, null],
    ["admin console", `/admin/queues/${cafeteria.id}`, admin],
    ["analytics", "/admin/analytics", admin],
    ["shift", "/admin/shift", admin],
    ["notices", "/admin/notices", admin],
    ["audit log", "/admin/audit", admin],
    ["catalog", "/admin/catalog", admin],
    ["access (global admin)", "/admin/access", admin],
    ["account security (admin)", "/security", admin],
    ["account security (student)", "/security", student],
    ["poster", `/admin/queues/${cafeteria.id}/poster`, admin],
    ["live view", "/admin/live", admin],
    ["live view (TV, high contrast)", `/admin/live?queue=${cafeteria.id}&contrast=high&tv=1`, admin],
    // Hindi and Bengali: longer words and other scripts must still fit and contrast.
    ["login (hi)", "/login", null, "hi"],
    ["queues (bn)", "/queues", student, "bn"],
    ["join (QR, bn)", `/join/${cafeteria.id}?src=qr`, null, "bn"],
    ["kiosk (hi)", `/kiosk/${cafeteria.id}`, null, "hi"],
    ["account security (bn)", "/security", student, "bn"],
    ["poster (bn)", `/admin/queues/${cafeteria.id}/poster`, admin, "bn"],
    ["live view (hi)", "/admin/live", admin, "hi"],
  ];
}

for (const theme of ["light", "dark"]) {
  test(`no serious accessibility violations (${theme})`, async ({ browser, request }) => {
    // 25 pages (incl. Hindi and Bengali) per theme.
    test.setTimeout(240_000);
    const failures = [];
    for (const [name, url, token, locale] of await pages(request)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, token, { theme, locale });
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      // Let enable/disable colour transitions finish (e.g. the poster's Print button) before measuring contrast.
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of results.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
        failures.push(`${name}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`);
      }
      await context.close();
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
