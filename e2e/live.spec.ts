import { expect, test } from "@playwright/test";
import { banner, expectStackedGraphs, pinchWheel, touchPinch, xTicks } from "./helpers";

test.describe.configure({ mode: "serial" });

test("a student tracks the fake ball live, from camera to graphs", async ({ page }) => {
  await page.goto("/live");

  // Step 1 — nothing on but the prompt to start the camera.
  await expect(banner(page)).toContainText("Step 1 of 3");
  await expect(banner(page)).toContainText("Press Start camera");
  await page.getByTestId("primary-action").click();

  // Step 2 — the fake camera shows the ball, the ring locks on.
  await expect(banner(page)).toContainText("Ready", { timeout: 15_000 });
  await expect(page.getByTestId("track-ring")).toBeVisible();
  await expect(page.getByTestId("scale-readout")).toContainText("px per m");
  await expect(page.getByTestId("primary-action")).toBeEnabled();

  // The drawn ball is 36 px across in a 640-wide feed → 0.36 m makes 1 px = 1 cm.
  await page.getByTestId("diameter-input").fill("0.36");
  await page.getByTestId("primary-action").click();

  // Step 3 — recording: red banner, live graphs filling with points.
  await expect(banner(page)).toContainText("Recording");
  await expect(banner(page)).toHaveAttribute("data-tone", "live");
  await expect(page.getByTestId("live-charts")).toBeVisible();
  await expect
    .poll(
      async () =>
        page.locator('[data-testid="live-charts"] [data-point]').count(),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(10);
  await page.waitForTimeout(2500);
  await page.getByTestId("primary-action").click(); // Stop

  // Done — frozen data, full stacked analysis.
  await expect(banner(page)).toContainText("Done");
  await expect(banner(page)).toHaveAttribute("data-tone", "done");
  await expect(page.getByTestId("live-charts")).toHaveCount(0);
  await expect(page.getByTestId("final-scale")).toContainText("px per m");
  await expectStackedGraphs(page);

  const rows = page.locator('[data-testid="data-table"] tbody tr');
  expect(await rows.count()).toBeGreaterThan(30);

  // The fake ball's vertical acceleration is −1.2 m s⁻² at this scale. The
  // feed loops every 6 s and is static for its first half second, so a run
  // may include a reset or a pause; allow a generous tolerance and only
  // require the sign and order of magnitude to be right.
  const aText = await page.getByTestId("fit-y").getByTestId("fit-a").textContent();
  const a = parseFloat(aText ?? "NaN");
  expect(a).toBeLessThan(-0.5);
  expect(a).toBeGreaterThan(-2.5);

  // Zoom: a trackpad pinch on chart 1 zooms every linked chart.
  const before = await xTicks(page, 0);
  await pinchWheel(page, '[data-testid="graphs"] [data-chart] svg', -300);
  await expect(page.getByTestId("reset-zoom")).toHaveCount(4);
  const after = await xTicks(page, 0);
  expect(after).not.toEqual(before);
  expect(await xTicks(page, 3)).toEqual(after);

  // Scroll: drag chart 2 left moves chart 1's time axis too.
  const svg2 = page.locator('[data-testid="graphs"] [data-chart] svg').nth(1);
  await svg2.scrollIntoViewIfNeeded(); // page.mouse only reaches what is on screen
  const b = (await svg2.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  const dragged = await xTicks(page, 0);
  expect(dragged).not.toEqual(after);

  // Reset returns to the full range.
  await page.getByTestId("reset-zoom").first().click();
  await expect(page.getByTestId("reset-zoom")).toHaveCount(0);
  expect(await xTicks(page, 0)).toEqual(before);

  // Touch pinch (iPad) zooms as well.
  await touchPinch(page, '[data-testid="graphs"] [data-chart] svg', 100, 300);
  await expect(page.getByTestId("reset-zoom").first()).toBeVisible();

  // New run returns to step 2 with the camera back on.
  await page.getByTestId("primary-action").click();
  await expect(banner(page)).toContainText("Step 2 of 3", { timeout: 15_000 });
});

test("a blank diameter gives arbitrary units and hides force and energy", async ({ page }) => {
  await page.goto("/live");
  await page.getByTestId("primary-action").click();
  await expect(banner(page)).toContainText("Ready", { timeout: 15_000 });

  await page.getByTestId("diameter-input").fill("");
  await expect(page.getByText(/Blank → arbitrary units/)).toBeVisible();
  await page.getByTestId("mass-input").fill("0.05");
  await expect(page.getByTestId("scale-readout")).toContainText("per a.u.");

  await page.getByTestId("primary-action").click(); // Start
  await expect(banner(page)).toContainText("Recording");
  await page.waitForTimeout(2000);
  await page.getByTestId("primary-action").click(); // Stop

  await expect(banner(page)).toContainText("Done");
  await expectStackedGraphs(page, false);
  await expect(page.getByTestId("au-note")).toContainText("arbitrary units");
  await expect(page.getByText("Energy stores–time")).toHaveCount(0);
  await expect(page.getByTestId("fit-y").getByTestId("fit-a")).toContainText("a.u. s⁻²");
  const header = page.locator('[data-testid="data-table"] thead').first();
  await expect(header).toContainText("x / a.u.");
  await expect(header).not.toContainText("KE / J");
});

test("with a mass, force and energy store graphs join the stack", async ({ page }) => {
  await page.goto("/live");
  await page.getByTestId("primary-action").click();
  await expect(banner(page)).toContainText("Ready", { timeout: 15_000 });
  await page.getByTestId("diameter-input").fill("0.36");
  await page.getByTestId("mass-input").fill("0.058");
  await page.getByTestId("primary-action").click(); // Start
  await page.waitForTimeout(2000);
  await page.getByTestId("primary-action").click(); // Stop
  await expect(banner(page)).toContainText("Done");
  await expectStackedGraphs(page, true);
  await expect(page.getByText("Kinetic store", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Gravitational potential store", { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-testid="data-table"] thead')).toContainText("Fx / N");
});
