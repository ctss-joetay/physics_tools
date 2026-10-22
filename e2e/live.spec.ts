import { expect, test, type Page } from "@playwright/test";
import { banner, expectStackedGraphs, pinchWheel, touchPinch, xTicks } from "./helpers";

test.describe.configure({ mode: "serial" });

/** A student would not press Stop before anything is recorded; nor do we. */
async function waitForLivePoints(page: Page, min = 30) {
  await expect
    .poll(
      async () => page.locator('[data-testid="live-charts"] [data-point]').count(),
      { timeout: 15_000, message: "live charts never received points — is the camera feed delivering frames?" },
    )
    .toBeGreaterThan(min);
}

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
  // The last camera frame stays on screen under the trail, not a black box.
  const freeze = page.getByTestId("freeze-frame");
  await expect(freeze).toBeVisible();
  expect(
    await freeze.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 60) bright++;
      return bright / (d.length / 4);
    }),
  ).toBeGreaterThan(0.9); // the grey background, not black
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

  // Hover: pointing at chart 2 shows "(t, y)" labels on every linked chart.
  const charts = page.locator('[data-testid="graphs"] [data-chart]');
  const nCharts = await charts.count();
  const b2 = (await svg2.boundingBox())!;
  const spot = { x: b2.x + b2.width * 0.5, y: b2.y + b2.height / 2 };
  await page.mouse.move(spot.x, spot.y);
  for (let i = 0; i < nCharts; i++) {
    await expect(charts.nth(i).locator("[data-pair]").first()).toContainText(/^\(.+ s, .+\)$/);
  }
  // Click pins it: it stays on every chart after the pointer leaves.
  await page.mouse.click(spot.x, spot.y);
  await page.mouse.move(0, 0);
  await expect(charts.nth(0).locator("[data-pair]").first()).toBeVisible();
  await expect(charts.nth(nCharts - 1).locator("[data-pair]").first()).toBeVisible();
  // Clicking the pinned point again releases it.
  await page.mouse.click(spot.x, spot.y);
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-testid="graphs"] [data-pair]')).toHaveCount(0);

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
  await waitForLivePoints(page);
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
  await page.getByTestId("primary-action").click(); // Start
  await waitForLivePoints(page);
  await page.getByTestId("primary-action").click(); // Stop
  await expect(banner(page)).toContainText("Done");
  // Forgot the mass? It can still be entered after the run has stopped.
  await expectStackedGraphs(page, false);
  await page.getByTestId("mass-input").fill("0.058");
  await expectStackedGraphs(page, true);
  await expect(page.getByText("Kinetic store", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Gravitational potential store", { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-testid="data-table"] thead')).toContainText("Fx / N");
});

test("recording stops by itself at the time limit", async ({ page }) => {
  await page.goto("/live?maxRun=2");
  await page.getByTestId("primary-action").click();
  await expect(banner(page)).toContainText("Ready", { timeout: 15_000 });
  await page.getByTestId("primary-action").click(); // Start
  await expect(banner(page)).toContainText("Recording");
  await expect(banner(page)).toContainText("Done", { timeout: 6_000 });
  await expect(page.getByTestId("final-scale")).toContainText(/over (1\.[5-9]|2\.\d) s/);
});

test("a double tap on Start camera opens one camera stream, not two", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await orig(c);
      w.__streams.push(s);
      return s;
    };
  });
  await page.goto("/live");
  await page.getByTestId("primary-action").dblclick();
  await expect(banner(page)).toContainText("Step 2 of 3", { timeout: 15_000 });
  await page.waitForTimeout(500);
  const live = await page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams.filter((s) =>
      s.getTracks().some((t) => t.readyState === "live"),
    ).length,
  );
  expect(live).toBe(1);
});
