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
    ["poster", `/admin/queues/${cafeteria.id}/poster`, admin],
  ];
}

for (const theme of ["light", "dark"]) {
  test(`no serious accessibility violations (${theme})`, async ({ browser, request }) => {
    test.setTimeout(120_000);
    const failures = [];
    for (const [name, url, token] of await pages(request)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, token, { theme });
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of results.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
        failures.push(`${name}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`);
      }
      await context.close();
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
